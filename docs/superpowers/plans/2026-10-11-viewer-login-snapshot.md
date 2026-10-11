# Viewer login snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the server's received mana and abilities even when their login packet arrives before the modern viewer starts.

**Architecture:** Pass the existing, session-owned GameInformation snapshot explicitly into the viewer adapter. Replay only validated JSON through the host's existing skills parser, retaining the original observation time; future packets remain authoritative.

**Tech Stack:** Node.js, Mineflayer, Socket.IO, node:test, pinned shared renderer.

**Spec:** User request of 2026-10-11: repair missing mana/skills without interrupting autonomous gameplay. This plan's constraints and acceptance scenarios are the implementation specification.

## Global Constraints

- Preserve the current Minecraft connection, entity and model processes.
- Do not fabricate fresh mana, ability availability or cooldown observations.
- Do not send game chat, commands or additional model calls for viewer repair.
- Preserve pinned renderer revision 79ddc629a7ba0c74ba064234e7928052be6dfc15.
- Commit native changes and verification to the authorized mc-agent-neko fork.

## Review Focus

- A login packet before viewer startup must appear for a newly connected browser.
- A stale snapshot must retain its timestamp and display its age.
- A snapshot belonging to another bot or a closed session must be ignored.
- Truncated or malformed snapshots must not crash startup or appear as authoritative state.
- A later live packet must replace the replayed snapshot for existing and new viewers.

---

### Task 1: Recover the received login state

**Files:** Modify `src/agent/agent.js`, `src/agent/vision/browser_viewer.js`, `scripts/import-modern-viewer.mjs`, generated `src/agent/vision/modern/host.mjs` and `source.json`; test `test/modern_viewer.test.mjs`.

**Interfaces:** `addBrowserViewer(bot, count_id, { gameInformation })`; optional host input `initialSkillsPacket = { channel, data: Buffer, observedAt }`.

- [ ] Add a regression using a same-bot GameInformation cache with `mana: { current: 26, max: 26 }`, nine abilities and an old timestamp; connect Socket.IO before awaiting its first event and assert receipt and the unchanged timestamp.
- [ ] Run `node --test test/modern_viewer.test.mjs` and confirm the login replay test fails.
- [ ] Reject closed, foreign-bot, truncated, non-JSON and oversized cache entries. Feed valid cached packets to `parseSkillsPayload`; preserve the original timestamp. Keep generated-host modifications reproducible in the importer.
- [ ] Assert malformed/foreign snapshots produce no skill state; inject a fresh protocol packet and assert its mana replaces the cache for subsequent subscribers.
- [ ] Run viewer, browser adapter and provenance tests. Document exact results, deploy matching files and reload only the viewer; compare game identity and sequence before/after, and observe actual LAN `skillsState` events.
- [ ] Commit only this repair, its tests and report; push the existing authorized branch.
