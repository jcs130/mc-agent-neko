"""Sequential public-text benchmark; write private WAVs only when requested."""
import argparse
from array import array
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen
import wave

SAMPLES = [
    '大家好，我是结衣。我们一起继续冒险吧。',
    '我先整理一下背包，准备好食物和工具，然后去看看附近有没有新的发现。',
    '谢谢你送给我的礼物！我会好好收下，也希望能帮上大家的忙。',
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voice', default='yui-local')
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.rounds <= 5:
        parser.error('rounds must be 1..5')
    args.output_directory.mkdir(parents=True, exist_ok=True)
    results = []
    for turn in range(args.rounds):
        for index, text in enumerate(SAMPLES):
            body = json.dumps({
                'model': 'indextts-2.5', 'voice': args.voice, 'input': text,
                'response_format': 'pcm',
                'extra_params': {'lang': 'zh'},
            }).encode()
            request = Request('http://127.0.0.1:18040/v1/audio/speech', data=body,
                              headers={'Content-Type': 'application/json'})
            started = time.perf_counter()
            with urlopen(request, timeout=240 if not results else 60) as response:
                first = response.read(4096)
                first_ms = (time.perf_counter() - started) * 1000
                audio = first + response.read()
            elapsed_ms = (time.perf_counter() - started) * 1000
            pcm = array('h')
            pcm.frombytes(audio)
            peak = max(abs(value) for value in pcm)
            rms = (sum(value * value for value in pcm) / len(pcm)) ** .5
            if len(audio) % 2 or len(pcm) < 24000 or peak < 1000 or rms < 100:
                raise RuntimeError('invalid synthesized PCM')
            with wave.open(str(args.output_directory / f'round-{turn+1}-sample-{index+1}.wav'), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(22050)
                wav.writeframes(audio)
            result = {'round': turn + 1, 'sample': index + 1, 'input_chars': len(text),
                      'first_ms': round(first_ms, 1), 'total_ms': round(elapsed_ms, 1),
                      'audio_s': round(len(pcm) / 22050, 3), 'peak': peak, 'rms': round(rms, 1)}
            results.append(result)
            (args.output_directory / 'results.json').write_text(json.dumps(results, indent=2))
            print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
