# Supervisor generation headroom Implementation Plan

> **For agentic workers:** Execute sequentially in this session without delegation.

**Goal:** Let low-thinking cloud supervisors finish their structured reports instead of repeatedly exhausting the generation budget during reasoning.

**Architecture:** Increase the existing bounded role budgets and synchronize the provider ceiling. Preserve the model, low effort, serial admission, audit cooldown, evidence freshness and independent review gates.

**Tech Stack:** DSH, pi-ai DeepSeek provider, Node.js tests.

**Spec / evidence:** `logs/hourly-dsh-token-evidence-20261010-1302.json` records six actual max-token sessions: five reviewers exhausted all 2560 tokens and one observer exhausted all 3072; their outputs contained only reasoning and no structured tool result. This is output budget exhaustion, not a local GPU queue or game fault.

- [x] Extend the role/provider budget regression to require structured-answer headroom above these observed cutoffs and retain a finite ceiling. Red: 19 passed / 1 failed on the observed too-small budget.
- [x] Set observer/reviewer budgets to 6144 and diagnoser to 4096; derive the shared provider ceiling from the role budgets, document the observed reason.
- [x] Run focused DSH tests and complete contribution test discovery, commit and push only these files. Focused: 36 passed; full: 634 passed.
- [x] Restart only the verified monitor process through its existing launcher and verify a real low-effort cloud audit. T-0015 actual occurrences=1; commit c303d2c. One-shot observer/diagnoser/reviewer all completed; after the 13:19:54 monitor deployment, two independent continuous audits completed without max-token truncation. T-0015 verified receipt API-confirmed; ticket not automatically closed. Game, model and desktop were retained.
