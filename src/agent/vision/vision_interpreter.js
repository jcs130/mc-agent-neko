import { Vec3 } from 'vec3';
import { captureModernView } from './modern_capture.js';

export class VisionInterpreter {
    constructor(agent, allow_vision) {
        this.agent = agent;
        this.bot = agent.bot;
        this.allow_vision = allow_vision;
        this._pending = null;
    }

    _available() {
        return this.allow_vision && typeof this.agent.prompter.vision_model?.sendVisionRequest === 'function';
    }

    _assertCurrent() {
        if (this.agent.bot !== this.bot || !this.bot.entity || this.bot.interrupt_code)
            throw new Error('Vision cancelled: game body changed or action interrupted.');
    }

    async lookAround() {
        if (!this._available()) return 'Vision is disabled. Use observed game state instead.';
        this._assertCurrent();
        if (this._pending) return this._pending;
        this._pending = this._describe().finally(() => { this._pending = null; });
        return this._pending;
    }

    async _describe() {
        const viewer = this.bot.viewer?.info;
        if (viewer?.type !== 'modern' || !viewer.available)
            throw new Error('Vision requires the modern browser viewer to be running.');
        const controller = new AbortController();
        const poll = setInterval(() => {
            if (this.agent.bot !== this.bot || this.bot.interrupt_code || !this.bot.entity)
                controller.abort(new Error('Vision cancelled: game body changed or interrupted.'));
        }, 100);
        try {
            const jpeg = await captureModernView(viewer.url, { signal: controller.signal });
            this._assertCurrent();
            const capturedAt = new Date().toISOString();
            const result = await this.analyzeImage(jpeg, { signal: controller.signal });
            this._assertCurrent();
            return `Visual observation captured at ${capturedAt} (rendered view; custom server textures may differ):\n${result}`;
        } finally {
            clearInterval(poll);
        }
    }

    async lookAtPlayer(player_name, direction) {
        if (!this._available()) return 'Vision is disabled. Use observed game state instead.';
        this._assertCurrent();
        const player = this.bot.players[player_name]?.entity;
        if (!player) return `Could not find player ${player_name}`;
        if (direction === 'with') await this.bot.look(player.yaw, player.pitch);
        else await this.bot.lookAt(player.position.offset(0, player.height || 1.6, 0));
        return this.lookAround();
    }

    async lookAtPosition(x, y, z) {
        if (!this._available()) return 'Vision is disabled. Use observed game state instead.';
        this._assertCurrent();
        await this.bot.lookAt(new Vec3(x, y + 2, z));
        return this.lookAround();
    }

    getCenterBlockInfo() {
        const block = this.bot.blockAtCursor(128);
        return block ? `Observed center block: ${block.name} at (${block.position.x}, ${block.position.y}, ${block.position.z})`
            : 'No block observed at center view.';
    }

    async analyzeImage(imageBuffer, { signal } = {}) {
        const history = this.agent.history.getHistory();
        // Keep grounded facts with the captured frame, rather than reading a
        // different center block after a potentially slow CPU vision request.
        const blockInfo = this.getCenterBlockInfo();
        const result = await this.agent.prompter.promptVision(history, imageBuffer, { signal });
        return `${result}\n${blockInfo}`;
    }
}
