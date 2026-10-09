import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class GPT {
    static prefix = 'openai';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url; // store so that we know whether a custom URL has been set

        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='***', options = {}) {
        let messages = strictFormat(turns);
        messages = messages.map(message => {
            message.content += stop_seq;
            return message;
        });
        let model = this.model_name || "gpt-5.4-mini";

        let res = null;

        try {
            console.log('Awaiting openai api response from model', model);
            // if a custom URL is set, use chat.completions
            // because custom "OpenAI-compatible" endpoints likely do not have responses endpoint
            if (this.url) {
                let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);
                messages = strictFormat(messages);
                const pack = {
                    model: model,
                    messages,
                    stop: stop_seq,
                    ...(this.params || {})
                };
                if (model.includes('o1') || model.includes('o3') || model.includes('5')) {
                    delete pack.stop;
                }
                let completion = await this.openai.chat.completions.create(pack, options);
                if (completion.choices[0].finish_reason == 'length')
                    throw new Error('Context length exceeded'); 
                console.log('Received.');
                res = completion.choices[0].message.content;
            } 
            // otherwise, use responses
            else {
                let messages = strictFormat(turns);
                messages = messages.map(message => {
                    message.content += stop_seq;
                    return message;
                });
                const response = await this.openai.responses.create({
                    model: model,
                    instructions: systemMessage,
                    input: messages,
                    ...(this.params || {})
                }, options);
                console.log('Received.');
                res = response.output_text;
                let stop_seq_index = res.indexOf(stop_seq);
                res = stop_seq_index !== -1 ? res.slice(0, stop_seq_index) : res;
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq, options);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer, mimeType = 'image/jpeg', { signal } = {}) {
        if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length || imageBuffer.length > 12 * 1024 * 1024)
            throw new Error('Vision requires a nonempty image of at most 12 MiB.');
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType))
            throw new Error('Unsupported vision image format.');
        // strictFormat is a text-only legacy formatter: adjacent user turns coerce
        // image arrays to "[object Object]". Keep the image in its own typed turn.
        const recent = messages.filter(m => typeof m.content === 'string').slice(-6)
            .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(-1000) }));
        const url = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
        const options = { timeout: 45000, maxRetries: 0, signal };
        if (this.url) {
            const completion = await this.openai.chat.completions.create({
                ...(this.params || {}), model: this.model_name,
                messages: [{ role: 'system', content: systemMessage }, ...recent, {
                    role: 'user', content: [
                        { type: 'text', text: 'Describe the attached current game view.' },
                        { type: 'image_url', image_url: { url } },
                    ],
                }],
            }, options);
            const result = completion.choices?.[0]?.message?.content;
            if (!result) throw new Error('Vision endpoint returned no image analysis.');
            return result;
        }
        const response = await this.openai.responses.create({
            ...(this.params || {}), model: this.model_name, instructions: systemMessage,
            input: [...recent, { role: 'user', content: [
                { type: 'input_text', text: 'Describe the attached current game view.' },
                { type: 'input_image', image_url: url },
            ] }],
        }, options);
        if (!response.output_text) throw new Error('Vision endpoint returned no image analysis.');
        return response.output_text;
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
        const embedding = await this.openai.embeddings.create({
            model: this.model_name || "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        return embedding.data[0].embedding;
    }

}

const sendAudioRequest = async (text, model, voice, url) => {
    const payload = {
        model: model,
        voice: voice,
        input: text
    }

    let config = {};

    if (url)
        config.baseURL = url;

    if (hasKey('OPENAI_ORG_ID'))
        config.organization = getKey('OPENAI_ORG_ID');

    config.apiKey = getKey('OPENAI_API_KEY');

    const openai = new OpenAIApi(config);

    const mp3 = await openai.audio.speech.create(payload);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64 = buffer.toString("base64");
    return base64;
}

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
}
