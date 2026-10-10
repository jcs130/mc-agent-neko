# Player Perception Implementation Plan

> **For agentic workers:** Implement sequentially with the existing diagnosis, Git and verification skills. Do not delegate or create a second game controller.

**Goal:** Keep real player contact and item interactions available to Neko without interrupting normal game work or adding periodic model calls.

**Architecture:** The native observation stream records received facts; the Minecraft plugin owns attention and bounded deferred delivery. Important distinct message batches must not replace each other in the host queue. The separate avatar fix refreshes expired local CSRF tokens without relaxing validation.

**Tech Stack:** Mineflayer/Node tests, Python 3.11 unittest, existing N.E.K.O. frontend, companion patch manifest.

**Spec:** User's 2026-10-10 requests to audit player greetings/channel mentions/gifts/system notices and explain local LLM, TTS and avatar routes.

- [x] Replay nonstandard chat, dropped equipment and collected items against the existing native observer; confirm failing cases before editing `src/websocket/game_information.js`.
- [x] Record actual item identity/count and collector, preserve raw channel text and resolved sender, and distinguish unknown donor from observed nearby players. No admin routing or game actions in the observer.
- [x] Test and fix independent attention batch keys, queued feedback during long actions, and social item collection at idle. Keep deduplication, body ownership and callback token bounds.
- [x] Test stale-token emotion requests, then refresh and retry only the known local-validation failure once in `static/app/app-buttons.js`.
- [x] Run relevant suites, export/replay scoped plugin and host patches, document evidence and limits, commit only owned files to the existing fork branch.
- [ ] Deploy at a safe idle boundary using the existing lifecycle, preserve main/model generations, and passively verify fresh runtime data. Report unexercised real-player scenarios honestly.
