import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { executionPromptTemplate, executionPromptHistory, sanitizeMemorySummary, memoryEvidence } from '../src/agent/context_budget.js';
import { RequestTrace } from '../src/utils/llm_timing.js';

function fixture({ external = true } = {}) {
    const calls = { examples: 0, requests: [] };
    const agent = { name: 'ag_NEKO', actions: {}, hasExternalAutonomyOwner: () => external,
        adminMission: { isActive: () => external, mission: { taskId: 'current-wood', text: 'Collect four logs', origin: 'ws' } },
        self_prompter: { isStopped: () => !external, prompt: 'Collect four logs' },
        history: { memory: 'Goal: Find village. Learned spruce recipe.', waitForMemory: async () => {},
            getHistory: () => [{ role: 'system', content: "You are self-prompting with the goal: 'Collect four logs'." },
                { role: 'system', content: 'Protected spruce_log at (1,64,2); choose another target.' }] } };
    const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date,
        executionPromptTemplate, executionPromptHistory, sanitizeMemorySummary, memoryEvidence,
        getCommand: name => ({ perform: () => name === '!stats' ? 'FRESH_HP20' : name === '!inventory' ? 'FRESH_LOG0' : 'FRESH_NEARBY' }),
        getCommandDocs: () => 'FULL_COMMAND_DOCS including !help and !goToSurface',
        settings: { log_all_prompts: false }, stringifyTurns: turns => turns.map(turn => turn.content).join('\n') });
    const source = readFileSync(new URL('../src/models/prompter.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export class Prompter', 'class Prompter')
        .replace(/^const __filename =.*\r?\nconst __dirname =.*\r?\n/m, '');
    vm.runInContext(source + '\nglobalThis.Prompter = Prompter;', context);
    const prompter = Object.create(context.Prompter.prototype); agent.prompter = prompter;
    Object.assign(prompter, { agent, cooldown: 0, profile: {
        conversing: 'PERSONA_STAYS\n$SELF_PROMPT\n## Current Status\n$STATS\n$INVENTORY\n## Available Commands\n$COMMAND_DOCS\n## Memory\n$MEMORY\n$EXAMPLES',
        saving_memory: 'Old Memory: $MEMORY\n$TO_SUMMARIZE' },
        convo_examples: { createExampleMessage: async () => { calls.examples++; return 'IRRELEVANT_HOUSE_EXAMPLE'; } },
        chat_model: { sendRequest: async (messages, prompt) => { calls.requests.push({ messages, prompt }); return '!inventory'; } },
        checkCooldown: async () => {}, _saveLog: async () => {} });
    return { agent, prompter, calls };
}

test('task inventory proof stays pinned beside the active task when raw history rolls over', () => {
    const f = fixture();
    f.agent.adminMission.progressEvidence = () => '\nMeasured task inventory: wooden_sword before=0 now=1 delta=1';
    const prompt = executionPromptTemplate('$STATS\n$INVENTORY', f.agent);
    assert.match(prompt, /wooden_sword before=0 now=1 delta=1/);
    assert.match(prompt, /taskId: current-wood/);
});

test('external execution skips irrelevant examples and puts full docs before changing state', async () => {
    const f = fixture(); await f.prompter.promptConvo(f.agent.history.getHistory());
    const { prompt, messages } = f.calls.requests[0];
    assert.equal(f.calls.examples, 0);
    assert(prompt.indexOf('FULL_COMMAND_DOCS') < prompt.indexOf('FRESH_HP20'));
    assert.match(prompt, /taskId: current-wood/);
    assert.match(prompt, /goal: Collect four logs/);
    assert.match(prompt, /historical memory.*not current instructions/);
    assert.match(prompt, /PERSONA_STAYS/);
    assert(messages.some(turn => /Protected spruce_log/.test(turn.content)));
    assert(!messages.some(turn => /self-prompting with the goal/.test(turn.content)));
});

test('standalone conversations keep their examples and original persona', async () => {
    const f = fixture({ external: false }); await f.prompter.promptConvo([]);
    assert.equal(f.calls.examples, 1);
    assert.match(f.calls.requests[0].prompt, /PERSONA_STAYS/);
});

test('the newest native loop turn survives projection as a compact command contract', async () => {
    const f = fixture();
    const reminder = "You are self-prompting with the goal: 'OLD DUPLICATE GOAL'. Your next response MUST contain a command with this syntax: !commandName. Respond:";
    const turns = [{ role: 'user', content: 'admin: Craft an iron sword from carried materials' },
        { role: 'assistant', content: '先走到村庄补给商旁边' },
        { role: 'system', content: reminder },
        { role: 'assistant', content: '先走到村庄补给商旁边' },
        { role: 'system', content: reminder }];
    const original = structuredClone(turns);
    f.agent.history.getHistory = () => turns;
    await f.prompter.promptConvo(turns);
    const projected = f.calls.requests[0].messages;
    assert.equal(projected.at(-1).role, 'system');
    assert.match(projected.at(-1).content, /EXECUTION TURN/);
    assert.match(projected.at(-1).content, /!commandName/);
    assert.match(projected.at(-1).content, /!endGoal.*verified success/);
    assert.match(projected.at(-1).content, /!cannotComplete/);
    assert.match(projected.at(-1).content, /prose plan is not an executed action/);
    assert.equal(projected.filter(turn => /EXECUTION TURN/.test(turn.content)).length, 1);
    assert(!projected.some(turn => /OLD DUPLICATE GOAL/.test(turn.content)));
    assert.deepEqual(turns, original, 'raw history and its archived evidence remain unchanged');
});

test('older loop reminders do not turn player conversation or actual results into execution triggers', () => {
    const f = fixture();
    const old = { role: 'system', content: "You are self-prompting with the goal: 'old goal'." };
    const action = { role: 'assistant', content: '!collectBlocks("oak_log", 1)' };
    const result = { role: 'system', content: 'Server protection deny; no blocks collected.' };
    const human = { role: 'user', content: 'You are self-prompting with the goal: hello, can we talk?' };
    const turns = [old, action, result, human];
    assert.deepEqual(executionPromptHistory(turns, f.agent), [action, result, human]);
    const standalone = fixture({ external: false });
    assert.equal(executionPromptHistory(turns, standalone.agent), turns);
});

test('memory drops stale status and goals while retaining learning and safety rules', () => {
    const summary = sanitizeMemorySummary('Status: Safe. HP 20, Food 14. At (-511,64,-318). Goal: Find village. Action: searching cow. Spruce planks make sticks. If HP <= 10 seek safety. 服务器保护拒绝后换目标。');
    assert.equal(summary, 'Spruce planks make sticks. If HP <= 10 seek safety. 服务器保护拒绝后换目标。');
});

test('prompt projection preserves actual observations and human messages verbatim', () => {
    const f = fixture(), turns = [{ role: 'user', content: 'Goal: discuss the server rules' },
        { role: 'system', content: 'Server text: do not mine here' }];
    assert.deepEqual(executionPromptHistory(turns, f.agent), turns);
    assert.deepEqual(memoryEvidence(turns), turns);
});

test('state is moved once, all command docs remain available, and goals keep constraints', () => {
    const f = fixture(); f.agent.adminMission.mission.text = 'Collect logs; do not break buildings; stop on danger';
    const template = executionPromptTemplate('PERSONA\n$STATS\n$INVENTORY\n$COMMAND_DOCS', f.agent);
    assert.equal(template.match(/\$STATS/g).length, 1);
    assert.equal(template.match(/\$INVENTORY/g).length, 1);
    assert.match(template, /\$COMMAND_DOCS/);
    assert.match(template, /do not break buildings; stop on danger/);
});

test('changing memory, selected code docs and goals follow every fixed execution rule', () => {
    const f = fixture();
    const template = 'PERSONA $MEMORY\n$CODE_DOCS\nFIXED_END\n$STATS\n$INVENTORY';
    const first = executionPromptTemplate(template, f.agent, 'FIXED_CONTRACT');
    f.agent.adminMission.mission.text = 'Another goal';
    const second = executionPromptTemplate(template, f.agent, 'FIXED_CONTRACT');
    assert.equal(first.split('DYNAMIC EXECUTION CONTEXT')[0], second.split('DYNAMIC EXECUTION CONTEXT')[0]);
    for (const marker of ['$MEMORY', '$CODE_DOCS', 'CURRENT TASK', '$STATS', '$INVENTORY']) {
        assert(first.indexOf('FIXED_CONTRACT') < first.indexOf(marker), marker);
    }
    assert.match(first, /Collect four logs/);
    assert.match(second, /Another goal/);
});

test('conversation hands its own trace to the executor only after a current accepted response', async () => {
    const f = fixture(), records = [];
    const trace = new RequestTrace(f.agent, 'execution', { sink: r => records.push(r) });
    f.prompter.chat_model.createTrace = () => trace;
    f.prompter.chat_model.sendRequest = async (_messages, _prompt, _stop, options) => {
        options.requestTrace.dispatch(); options.requestTrace.returned({}, 'stop'); return '!inventory';
    };
    let accepted;
    assert.equal(await f.prompter.promptConvo([], { onTrace: value => { accepted = value; } }), '!inventory');
    assert.equal(accepted, trace);
    assert.equal(trace.closed, false, 'the executor, not the model adapter, validates commands');
    trace.mark('command_validated'); trace.finish('command_ready');
    assert(records.at(-1).prompt_assembly_ms !== null);
    assert(records.at(-1).total_to_command_ms !== null);
});

test('ordinary goal-only experiment preserves every literal and placeholder, after docs before memory', () => {
    const f = fixture({ external: false });
    const source = 'PERSONA\n$SELF_PROMPT\nFIXED_RULES\n$COMMAND_DOCS\n## Memory\n$MEMORY\n$SELF_PROMPT\n$EXAMPLES';
    const previous = process.env.MC_SELF_PROMPT_TAIL;
    try {
        process.env.MC_SELF_PROMPT_TAIL = '0';
        const baseline = executionPromptTemplate(source, f.agent);
        process.env.MC_SELF_PROMPT_TAIL = '1';
        const moved = executionPromptTemplate(source, f.agent);
        assert(moved.indexOf('$COMMAND_DOCS') < moved.indexOf('$SELF_PROMPT'));
        assert(moved.lastIndexOf('$SELF_PROMPT') < moved.indexOf('$MEMORY'));
        assert.equal(moved.replaceAll('$SELF_PROMPT', ''), baseline.replaceAll('$SELF_PROMPT', ''));
        assert.equal(moved.match(/\$SELF_PROMPT/g).length, 2);
        assert(moved.indexOf('$SELF_PROMPT') < moved.indexOf('## Memory'));
    } finally { if (previous === undefined) delete process.env.MC_SELF_PROMPT_TAIL; else process.env.MC_SELF_PROMPT_TAIL = previous; }
});

test('ordinary goal experiment is inactive for external missions, code contracts or ambiguous templates', () => {
    const f = fixture(), ordinary = fixture({ external: false });
    const previous = process.env.MC_SELF_PROMPT_TAIL;
    try {
        process.env.MC_SELF_PROMPT_TAIL = '0';
        const external = executionPromptTemplate(f.prompter.profile.conversing, f.agent);
        const code = executionPromptTemplate('$SELF_PROMPT\n$COMMAND_DOCS\n$MEMORY', ordinary.agent, 'fixed coding contract');
        process.env.MC_SELF_PROMPT_TAIL = '1';
        assert.equal(executionPromptTemplate(f.prompter.profile.conversing, f.agent), external);
        assert.equal(executionPromptTemplate('$SELF_PROMPT\n$COMMAND_DOCS\n$MEMORY', ordinary.agent, 'fixed coding contract'), code);
        for (const source of ['$SELF_PROMPT\n$MEMORY\n$COMMAND_DOCS', '$SELF_PROMPT\nno tool boundary', '$COMMAND_DOCS\n$MEMORY']) {
            assert.equal(executionPromptTemplate(source, ordinary.agent), source);
        }
        assert.equal(executionPromptTemplate('$SELF_PROMPT\n$COMMAND_DOCS', ordinary.agent), '\n$COMMAND_DOCS$SELF_PROMPT');
    } finally { if (previous === undefined) delete process.env.MC_SELF_PROMPT_TAIL; else process.env.MC_SELF_PROMPT_TAIL = previous; }
});
