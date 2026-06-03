# Phase 0 Validation — Tauri 2 Scaffold + Rust Idle Timer + IPC + SQLite Session Store

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff `cargo tauri dev` opens a window with no console errors.
- [ ] PASS iff `decay-update` events appear in the browser console at approximately 10 Hz when no keys are pressed, and the `ms_idle` field increments by ~100 per event.
- [ ] PASS iff pressing any key in the editor causes the `ms_idle` value in the next `decay-update` event to be less than 200 ms (reset confirmed).
- [ ] PASS iff `cargo test -- session_store` exits 0 and all session store tests pass: round-trip creates a session, records 3 keystrokes, ends session, returns `word_count = 0` and `decay_events = 0`.
- [ ] PASS iff `pnpm vitest run` exits 0 (empty or stub test suite is acceptable in Phase 0).
- [ ] PASS iff `~/.pressfield/pressfield.db` exists after the first app launch and is a valid SQLite database.
- [ ] PASS iff `cat progress.json` is valid JSON with every Phase 0 task status = "done".
- [ ] PASS iff `cat tests.json` is valid JSON listing planned test cases for all phases.

FAIL on any unchecked box → fix before advancing to Phase 1.
