// A fresh writer stamp is insufficient. Server world age changes only on an
// update_time packet; position and command-log silence also occur during idle.
export function advanceServerLiveness(previous, frame, state, now = Date.now()) {
    const position = frame?.state?.self?.position, vitals = state?.v;
    const age = frame?.state?.world?.age, at = frame?.observedAt;
    const matches = value => value && vitals && ['x', 'y', 'z'].every(key =>
        Number.isFinite(value[key]) && Number.isFinite(vitals[key]) && Math.abs(value[key] - vitals[key]) <= 2);
    const recent = value => Number.isFinite(value) && value <= now + 5000 && now - value <= 45000;
    const connectionAt = frame ? at : previous?.connectionObservedAt;
    const connection = { connectionObservedAt: connectionAt,
        connectionOnline: recent(connectionAt) ? (frame ? frame.online : previous?.connectionOnline) ?? null : null };
    // The writer can be between writes. Retain a still-recent packet proof,
    // without extending its original expiry or borrowing a different position.
    if (!frame) return { ...previous, ...connection, checkedAt: now,
        confirmedLive: Boolean(connection.connectionOnline !== false && matches(previous?.position) && Number.isFinite(previous?.lastAdvanceAt)
            && previous.lastAdvanceAt <= now && now - previous.lastAdvanceAt <= 45000) };
    // Disconnect telemetry can arrive before the older vitals writer expires.
    // Its missing world age is a connection failure, not evidence of a live loop freezing.
    if (connection.connectionOnline === false) return { ...connection, sessionId: frame.sessionId ?? null,
        sourceAt: at, checkedAt: now, confirmedLive: false, reason: 'game_connection_offline' };
    if (frame?.online !== true || typeof frame.sessionId !== 'string' || !frame.sessionId
        || !Number.isFinite(at) || at > now + 5000 || now - at > 45000
        || !Number.isSafeInteger(age) || age < 0 || !matches(position)) {
        return { ...previous, ...connection, checkedAt: now, confirmedLive: false, reason: 'no_matching_fresh_packet_evidence' };
    }
    const sameSession = previous?.sessionId === frame.sessionId && previous.checkedAt <= now
        && now - previous.checkedAt <= 90000 && at >= previous.sourceAt;
    const advanced = sameSession && at > previous.sourceAt && age !== previous.age;
    const lastAdvanceAt = advanced ? now : sameSession ? previous.lastAdvanceAt : null;
    return { ...connection, sessionId: frame.sessionId, age, sourceAt: at, position: { ...position }, checkedAt: now, lastAdvanceAt,
        confirmedLive: Number.isFinite(lastAdvanceAt) && now - lastAdvanceAt <= 45000 };
}

export function frozenAliveConfirmed(state) {
    return Boolean(state?._frozen?.frozenMs >= 120000 && state._frozen.eventsAgeS >= 120
        && state._serverLiveness?.connectionOnline !== false
        && state._serverLiveness?.confirmedLive !== true);
}
