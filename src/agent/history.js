import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';
import { sanitizeMemorySummary, memoryEvidence, boundedPromptHistory, externalMission } from './context_budget.js';


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];
        this.complete_turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 5;
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary
        this.pending_memory = [];
        this._memoryIntervalMs = 45000;
        this._pendingCharLimit = 8000;
        this._pendingTurnLimit = 32;
        this._lastSummaryAt = Date.now();
        this._summaryGeneration = 0;
        this._summaryInFlight = null;
        this._summaryTimer = null;
        this._summaryRetryAfter = 0;
    }

    getHistory() { // expects an Examples object
        // Every received turn remains visible after summarization as well as
        // before it. Only an explicit clear() removes conversation evidence.
        return boundedPromptHistory(this.complete_turns);
    }

    getTaskHistory() {
        const mission = externalMission(this.agent);
        const start = mission?.historyStart;
        // Scope by a controller-owned task boundary, never by character or
        // turn quotas. Every turn of this task stays complete after summaries.
        if (Number.isSafeInteger(start) && start >= 0 && start <= this.complete_turns.length)
            return boundedPromptHistory(this.complete_turns.slice(start));
        return this.getHistory();
    }

    getEvidenceIndex() {
        return { historical: true, total: this.complete_turns.length,
            memoryAvailable: !!this.memory, read: '!historyEntry(index), !historyMemory()',
            entries: this.complete_turns.map((turn, index) => ({ index, role: turn.role,
                chars: String(turn.content || '').length, taskId: turn.taskId ?? null,
                recordedAt: turn.recordedAt ?? null })) };
    }

    getEvidenceEntry(index) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.complete_turns.length)
            return { status: 'unavailable', reason: 'History index is out of range; use !historyIndex().' };
        return { status: 'ok', historical: true, index, total: this.complete_turns.length,
            turn: boundedPromptHistory([this.complete_turns[index]])[0], responseTruncated: false };
    }

    async summarizeMemories(turns, oldMemory = this.memory) {
        console.log("Storing memories...");
        const reply = await this.agent.prompter.promptMemSaving(memoryEvidence(turns), oldMemory);
        if (typeof reply !== 'string' || !reply.trim() || /^(?:My brain disconnected|Context length exceeded)/i.test(reply.trim()))
            throw new Error('Memory summary unavailable; original observations retained');
        return sanitizeMemorySummary(reply);
    }

    _memoryCapacityReached() {
        return this.pending_memory.length >= this._pendingTurnLimit
            || this.pending_memory.reduce((sum, turn) => sum + turn.content.length, 0) >= this._pendingCharLimit;
    }

    _nextMemoryBatch() {
        const batch = [];
        let chars = 0;
        for (const turn of this.pending_memory) {
            if (batch.length >= 32 || (batch.length && chars + turn.content.length > 8000)) break;
            batch.push(turn);
            chars += turn.content.length;
            // A single oversized observation is summarized whole; avoid
            // combining it with other observations in a background batch.
            if (chars >= 8000) break;
        }
        return batch;
    }

    _scheduleMemoryFlush(delay = Math.max(0, this._memoryIntervalMs - (Date.now() - this._lastSummaryAt))) {
        if (this._summaryTimer || !this.pending_memory.length) return;
        this._summaryTimer = setTimeout(() => {
            this._summaryTimer = null;
            void this.flushMemories();
        }, delay);
        this._summaryTimer.unref?.();
    }

    async waitForMemory() {
        const active = this._summaryInFlight;
        if (!active) return;
        let deadline;
        try {
            // An unavailable memory service must not freeze action inference.
            // The request remains singleflight and may still commit later.
            await Promise.race([active, new Promise(resolve => {
                deadline = setTimeout(resolve, 8000);
                deadline.unref?.();
            })]);
        } finally {
            if (deadline) clearTimeout(deadline);
        }
    }

    flushMemories(force = false) {
        if (this._summaryInFlight) return this._summaryInFlight;
        if (!this.pending_memory.length) return Promise.resolve();
        if (!force && Date.now() < this._summaryRetryAfter) {
            this._scheduleMemoryFlush(this._summaryRetryAfter - Date.now());
            return Promise.resolve();
        }
        // Native action inference has priority. Do not queue a competing memory
        // request on the same local GPU while it is deciding the next action.
        if (this.agent.prompter._activeConversationRequests || this.agent.prompter.awaiting_coding) {
            this._scheduleMemoryFlush(1000);
            return Promise.resolve();
        }
        if (!force && !this._memoryCapacityReached() && Date.now() - this._lastSummaryAt < this._memoryIntervalMs) {
            this._scheduleMemoryFlush();
            return Promise.resolve();
        }
        if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }
        const generation = this._summaryGeneration;
        const run = async () => {
            const batch = this._nextMemoryBatch(), previousMemory = this.memory;
            const next = await this.summarizeMemories(batch, previousMemory);
            if (generation !== this._summaryGeneration) return;
            this.memory = next;
            this.pending_memory.splice(0, batch.length);
            // Summaries supplement complete_turns; they never replace its evidence.
            this._lastSummaryAt = Date.now();
            this._summaryRetryAfter = 0;
            try { await this.save(); }
            catch (error) {
                this.pending_memory.unshift(...batch);
                this.memory = previousMemory;
                throw error;
            }
            console.log('Memory updated to: ', this.memory);
            // A later flush sees this committed memory. Yield between
            // bounded batches so action inference can take priority.
        };
        const promise = run().catch(error => {
            if (generation === this._summaryGeneration) {
                this._lastSummaryAt = Date.now();
                this._summaryRetryAfter = this._lastSummaryAt + this._memoryIntervalMs;
            }
            console.warn('Memory summary deferred:', error.message);
        }).finally(() => {
            if (this._summaryInFlight === promise) this._summaryInFlight = null;
            const delay = this._summaryRetryAfter > Date.now()
                ? this._summaryRetryAfter - Date.now()
                : this._memoryCapacityReached() ? 1000 : undefined;
            this._scheduleMemoryFlush(delay);
        });
        this._summaryInFlight = promise;
        return promise;
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        const turn = { role, content, recordedAt: Date.now(),
            taskId: externalMission(this.agent)?.taskId ?? null };
        this.turns.push(turn);
        this.complete_turns.push(turn);

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            this.pending_memory.push(...chunk);
            await this.appendFullHistory(chunk);
            // Normal overflow accumulates for one 45s batch. Capacity pressure
            // forces a flush; raw evidence remains visible until it succeeds.
            void this.flushMemories();
        }
    }

    async save() {
        try {
            // AdminMission is intentionally in-memory only — a crashed mid-mission task is DROPPED
            // (matches the "no memory / no revival" contract) instead of auto-restarting via
            // self_prompter.handleLoad. While a mission runs, self_prompter mirrors the mission text
            // in ACTIVE state; we scrub it from the persisted snapshot so restart comes up headless.
            const _mActive = !!(this.agent && this.agent._missionEnabled && this.agent.adminMission && this.agent.adminMission.isActive());
            const data = {
                memory: this.memory,
                turns: this.turns,
                pending_memory: this.pending_memory,
                complete_turns: this.complete_turns,
                self_prompting_state: _mActive ? 0 : this.agent.self_prompter.state,   // 0 === SelfPrompter STOPPED
                self_prompt: (_mActive || this.agent.self_prompter.isStopped()) ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this._summaryGeneration++;
            if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }
            this.memory = sanitizeMemorySummary(data.memory || '');
            this.turns = data.turns || [];
            this.pending_memory = data.pending_memory || [];
            this.complete_turns = data.complete_turns || [...this.pending_memory, ...this.turns];
            this._lastSummaryAt = Date.now();
            this._summaryRetryAfter = 0;
            this._scheduleMemoryFlush();
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this._summaryGeneration++;
        if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }
        this.turns = [];
        this.pending_memory = [];
        this.complete_turns = [];
        this.memory = '';
        this._lastSummaryAt = Date.now();
        this._summaryRetryAfter = 0;
    }
}
