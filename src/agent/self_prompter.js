const STOPPED = 0
const ACTIVE = 1
const PAUSED = 2
export class SelfPrompter {
    constructor(agent) {
        this.agent = agent;
        this.state = STOPPED;
        this.loop_active = false;
        this.interrupt = false;
        this._stopPromise = null;
        this._loopGeneration = 0;
        this.prompt = '';
        this.idle_time = 0;
        this.cooldown = 2000;
        // ★2026-07-07 owner hook: when an AdminMission drives this loop it sets `owner=this`, so the
        //   MAX_NO_COMMAND branch hands off to owner.onNoProgress() (done/impossible/continue
        //   adjudication) instead of blindly STOPPING — a mission must not silently self-terminate.
        this.owner = null;
    }

    start(prompt) {
        console.log('Self-prompting started.');
        if (!prompt) {
            if (!this.prompt)
                return 'No prompt specified. Ignoring request.';
            prompt = this.prompt;
        }
        this.state = ACTIVE;
        this.prompt = prompt;
        this.startLoop().catch(error => console.error('Self-prompt loop failed:', error));
    }

    isActive() {
        return this.state === ACTIVE;
    }

    isStopped() {
        return this.state === STOPPED;
    }

    isPaused() {
        return this.state === PAUSED;
    }

    async handleLoad(prompt, state) {
        if (state == undefined)
            state = STOPPED;
        this.state = state;
        this.prompt = prompt;
        if (state !== STOPPED && !prompt)
            throw new Error('No prompt loaded when self-prompting is active');
        if (state === ACTIVE) {
            await this.start(prompt);
        }
    }

    setPromptPaused(prompt) {
        this.prompt = prompt;
        this.state = PAUSED;
    }

    async startLoop() {
        if (this.loop_active) {
            console.warn('Self-prompt loop is already active. Ignoring request.');
            return;
        }
        console.log('starting self-prompt loop')
        this.loop_active = true;
        const generation = ++this._loopGeneration;
        let no_command_count = 0;
        const MAX_NO_COMMAND = 3;
        try {
        while (!this.interrupt) {
            // ★PARK (no strike) while a supervised skill owns the body: handleMessage('system')
            //   early-returns false under supervised_skill (agent.js), so without this park each
            //   such turn burns a MAX_NO_COMMAND strike → a legit supervised skill doing the work
            //   would false-trip "give up" in ~6s. The skill's own progress IS progress.
            if (this.agent.supervised_skill) {
                await new Promise(r => setTimeout(r, this.cooldown));
                continue;
            }
            const msg = `You are self-prompting with the goal: '${this.prompt}'. Your next response MUST contain a command with this syntax: !commandName. Respond:`;

            let used_command = await this.agent.handleMessage('system', msg, -1);
            if (!used_command) {
                no_command_count++;
                if (no_command_count >= MAX_NO_COMMAND) {
                    if (this.owner) {
                        // ★owned by an AdminMission: DON'T blindly stop. Hand off to the owner's
                        //   adjudication (done → !endGoal / impossible → !cannotComplete / continue).
                        //   Release the loop first so owner.onNoProgress() may restart it cleanly.
                        this.loop_active = false;
                        this.interrupt = false;
                        try { await this.owner.onNoProgress(); } catch (e) { console.error('onNoProgress error:', e); }
                        return;
                    }
                    let out = `Agent did not use command in the last ${MAX_NO_COMMAND} auto-prompts. Stopping auto-prompting.`;
                    this.agent.openChat(out);
                    console.warn(out);
                    this.state = STOPPED;
                    break;
                }
                // ★cooldown even on a no-command turn (was a busy-spin: the no-command branch
                //   looped with no delay, hammering the LLM when responses came back fast).
                await new Promise(r => setTimeout(r, this.cooldown));
            }
            else {
                no_command_count = 0;
                await new Promise(r => setTimeout(r, this.cooldown));
            }
        }
        } finally {
            console.log('self prompt loop stopped')
            if (this._loopGeneration === generation) {
                this.loop_active = false;
                this.interrupt = false;
            }
        }
    }

    update(delta) {
        // automatically restarts loop
        if (this.state === ACTIVE && !this.loop_active && !this.interrupt) {
            if (this.agent.isIdle())
                this.idle_time += delta;
            else
                this.idle_time = 0;

            if (this.idle_time >= this.cooldown) {
                console.log('Restarting self-prompting...');
                this.startLoop().catch(error => console.error('Self-prompt loop failed:', error));
                this.idle_time = 0;
            }
        }
        else {
            this.idle_time = 0;
        }
    }

    async stopLoop() {
        // you can call this without await if you don't need to wait for it to finish
        if (this._stopPromise) return this._stopPromise;
        console.log('stopping self-prompt loop')
        this.interrupt = true;
        const stopped = (async () => {
            while (this.loop_active) {
                await new Promise(r => setTimeout(r, 50));
            }
            this.interrupt = false;
        })();
        this._stopPromise = stopped;
        try {
            await stopped;
        } finally {
            if (this._stopPromise === stopped) this._stopPromise = null;
        }
    }

    async stop(stop_action=true, wait_for_loop=false) {
        this.state = STOPPED;
        const stopped = this.stopLoop();
        if (stop_action)
            await this.agent.actions.stop();
        // Commands such as !endGoal can run inside this loop. They must
        // signal stop without waiting for themselves; an external mission
        // handoff explicitly waits before installing its replacement.
        if (wait_for_loop) await stopped;
    }

    async pause() {
        this.state = PAUSED;
        this.stopLoop();
        await this.agent.actions.stop();
        // pause may also be requested by the current command turn.
    }

    shouldInterrupt(is_self_prompt) { // to be called from handleMessage
        return is_self_prompt && (this.state === ACTIVE || this.state === PAUSED) && this.interrupt;
    }

    handleUserPromptedCmd(is_self_prompt, is_action) {
        // if a user messages and the bot responds with an action, stop the self-prompt loop
        if (!is_self_prompt && is_action) {
            this.stopLoop();
            // this stops it from responding from the handlemessage loop and the self-prompt loop at the same time
        }
    }
}
