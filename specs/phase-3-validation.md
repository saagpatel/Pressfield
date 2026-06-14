# Phase 3 Validation — Stats, Export, Themes, Hardcore Scaffold

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff the stats panel displays live word count, decay events survived, and elapsed session time, and these values update within 5 seconds of writing or recovering from a decay event.
- [ ] PASS iff after surviving 3 decay events in a session, the `decay_events` counter in the stats panel reads exactly 3.
- [ ] PASS iff clicking "Copy clean text" while canvas decay distortion is visible copies the full, undistorted prose to the clipboard (paste into Notes confirms clean text).
- [ ] PASS iff the dark theme is the default and the light theme renders the app correctly; decay distortion (blur, drift, fringe) is visible on both themes.
- [ ] PASS iff the selected theme persists across app restart (localStorage confirmed).
- [ ] PASS iff the hardcore toggle renders in the settings panel in a disabled state with a tooltip reading "coming in v2" or equivalent.
- [ ] PASS iff clicking the hardcore toggle does nothing (no console error, no text mutation, no state change).
- [ ] PASS iff `vitest` asserts that `contenteditable.innerText` is byte-identical before and after a simulated decay event (the hardcore-guard test).
- [ ] PASS iff the session history table displays the last 10 sessions with correct word count, decay event count, and session duration for each.
- [ ] PASS iff after 2 test sessions, both appear in the history table with accurate data.
- [ ] PASS iff `pnpm vitest run` exits 0.
- [ ] PASS iff `cargo test` exits 0.
- [ ] PASS iff `cargo tauri build` completes without error and produces a `.dmg` or `.app` bundle that launches on the development machine.

FAIL on any unchecked box → the phase is not complete. Do not advance without a passing build artifact.
