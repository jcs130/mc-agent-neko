import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha = value => createHash('sha256').update(value).digest('hex');
const textOf = value => [value.message, value.error, value.reason]
    .map(v => typeof v === 'string' ? v : '').find(v => v.trim()) ?? '';
const privateOperands = text => text.replace(/\/(login|register|reg|changepassword)\s+[^\r\n]+/gi, '/$1 [private]')
    .replace(/\b(Bearer)\s+[^\s"']+/gi, '$1 [private]');

// These are native command/result boundaries, not a search for error-like words
// in inventories, player chat or books. Originals remain in the event log.
export function projectExecution(value, receiptId) {
    const originalText = textOf(value), body = privateOperands(originalText);
    const original = { receiptId, chars: originalText.length, sha256: sha(originalText) };
    const headers = [...originalText.matchAll(/^(![A-Za-z][A-Za-z0-9_]*):\s*\r?\n/gm)];
    // ws_server.finishMission appends this inventory footer after all command
    // observations. Its changing contents are not part of the final refusal.
    const footer = originalText.lastIndexOf('\n\n当前持有道具：');
    const failures = new Map();
    const add = (command, reason, start, end) => {
        const causeId = sha(JSON.stringify([command, reason])).slice(0, 24);
        const existing = failures.get(causeId);
        if (existing) { existing.occurrences++; return; }
        const detailsIncomplete = reason.length > 800;
        failures.set(causeId, { command, causeId, occurrences: 1,
            reason: detailsIncomplete ? reason.slice(0, 160) + ' [full reason in original reference]' : reason,
            detailsIncomplete, original: { ...original, start, end } });
    };
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i], command = header[1];
        const start = header.index + header[0].length;
        const end = headers[i + 1]?.index ?? (footer >= start ? footer : originalText.length);
        const result = originalText.slice(start, end).trim();
        const marker = /^Action failed: (![A-Za-z][A-Za-z0-9_]*)[^\r\n]*(?:\r?\n|$)/m.exec(result);
        if (!marker || marker[1] !== command) continue;
        const reason = result.slice(marker.index + marker[0].length).trim()
            .replace(/^Action output:\s*\r?\n/, '').trim() || marker[0].trim();
        add(command, privateOperands(reason), start, end);
    }
    if (!failures.size && value.ok === false) {
        const operation = typeof value.command === 'string' ? value.command.split(/\s/, 1)[0] : value.type;
        add(operation || 'unknown-command', body, 0, originalText.length);
    }
    if (!failures.size && !headers.length) {
        const exceptions = originalText.match(/(?:TypeError|ReferenceError|SyntaxError|RangeError|Error):[^\n]+/g) ?? [];
        for (const exception of exceptions.slice(0, 3)) add('native-exception', privateOperands(exception), originalText.indexOf(exception), originalText.indexOf(exception) + exception.length);
    }
    const all = [...failures.values()], visible = all.slice(0, 3);
    const firstLine = body.split(/\r?\n/, 1)[0];
    const summary = [firstLine.slice(0, 160), ...visible.map(f => `${f.command}: ${f.reason} (observed ${f.occurrences} times)`)].join('\n');
    return { at: value.at, type: value.type, status: value.status, ok: value.ok,
        taskId: value.task_id, message: summary.length > 650 ? summary.slice(0, 590) + '\n[Exact failures and original reference below]' : summary,
        failures: visible, omittedFailureTypes: Math.max(0, all.length - visible.length),
        original, executionStopped: value.type === 'task_finished',
        omittedSuccessfulCommandResults: Math.max(0, headers.length - all.reduce((n, f) => n + f.occurrences, 0)),
        detailsPolicy: 'Failure facts are projected separately; omitted results remain available by immutable receipt ID and digest. Missing detail is not evidence of success.',
    };
}

export function executionCause(value) {
    const projected = projectExecution(value);
    return projected.failures.length ? projected.failures.map(f => [f.command, f.causeId])
        : [privateOperands(textOf(value)).split(/\r?\n/, 1)[0]];
}

export function appearanceFact(packet) {
    const value = packet?.value;
    if (!value || typeof value !== 'object') return null;
    return { subject: value.playerUuid || value.playerName || null, playerName: value.playerName ?? null,
        available: value.available, reason: value.reason ?? null, source: value.source ?? null,
        model: value.model ?? value.modelId ?? null, skin: value.skin ?? null };
}

export function readReceiptEvidence(nativeRoot, receiptId, command) {
    if (!/^native\.execution\.\d+\.[a-f0-9]{12}$/.test(receiptId ?? '')) throw Error('Invalid native receipt reference');
    if (command !== undefined && !/^![A-Za-z][A-Za-z0-9_]*$/.test(command)) throw Error('Invalid command selection');
    for (const file of ['events.log', 'events.log.1']) {
        const sourcePath = path.resolve(nativeRoot, 'bots/_supervisor', file);
        if (!fs.existsSync(sourcePath)) continue;
        for (const line of fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/)) {
            const match = /^\[([^\]]+)\]\s+(\{.*\})$/.exec(line);
            if (!match) continue;
            let value; try { value = JSON.parse(match[2]); } catch { continue; }
            const at = Date.parse(match[1]);
            if (`native.execution.${at}.${sha(JSON.stringify(value)).slice(0, 12)}` !== receiptId) continue;
            const original = textOf(value), headers = [...original.matchAll(/^(![A-Za-z][A-Za-z0-9_]*):\s*\r?\n/gm)];
            const footer = original.lastIndexOf('\n\n当前持有道具：');
            const sections = headers.map((header, index) => {
                const start = header.index + header[0].length;
                return { command: header[1], start, end: headers[index + 1]?.index ?? (footer >= start ? footer : original.length) };
            });
            return { available: true, receiptId, sourcePath, observedAt: at, projection: projectExecution(value, receiptId),
                commandSections: sections.map(section => ({ ...section, chars: section.end - section.start })),
                ...(command ? { commandResults: sections.filter(section => section.command === command)
                    .map(section => ({ ...section, text: privateOperands(original.slice(section.start, section.end).trim()) })) } : {}) };
        }
    }
    return { available: false, receiptId, reason: 'Original not present in the owned journal or its retained rotation; consult the original task store. Missing detail does not prove success.' };
}
