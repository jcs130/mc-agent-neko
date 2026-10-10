import { createHash } from 'node:crypto';

export function initialEventCursor(saved, legacyAt, now = Date.now()) {
    const valid = at => Number.isFinite(at) && at >= 0 && at <= now;
    if (valid(saved?.at)) return { at: saved.at, ids: Array.isArray(saved.ids) ? saved.ids.filter(id => typeof id === 'string') : [] };
    return { at: valid(legacyAt) ? legacyAt : now, ids: [] };
}

// Advance only past confirmed processing. Persisting all IDs at the watermark
// preserves distinct events sharing a millisecond without replaying them.
export async function consumeEvents(lines, previous, onEvent, now = Date.now()) {
    let cursor = { at: previous.at, ids: [...previous.ids] };
    const events = lines.flatMap(line => {
        const match = /^\[([^\]]+)\]/.exec(line);
        const at = match ? Date.parse(match[1]) : NaN;
        return Number.isFinite(at) && at <= now ? [{ at, line,
            id: createHash('sha256').update(line).digest('hex').slice(0, 16) }] : [];
    }).sort((a, b) => a.at - b.at);
    for (const event of events) {
        if (event.at < cursor.at || event.at === cursor.at && cursor.ids.includes(event.id)) continue;
        if (!await onEvent(event.line, event.at)) break;
        cursor = event.at === cursor.at ? { at: cursor.at, ids: [...cursor.ids, event.id] }
            : { at: event.at, ids: [event.id] };
    }
    return cursor;
}
