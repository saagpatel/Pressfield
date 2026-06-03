# Phase 2 Validation — Decay Tuning, Intensity Setting, Word Drift, Robustness

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff word drift is visually apparent at `level = 0.8` with `normal` intensity (~4 seconds idle): words have measurably diverged from their line anchors in distinct directions.
- [ ] PASS iff drift direction for each word is consistent across animation frames (same word always drifts the same direction at the same level — not random per frame).
- [ ] PASS iff a faint chromatic aberration fringe is visible at `level = 0.7` on a light-background theme, and prominent at `level = 1.0`.
- [ ] PASS iff `pnpm vitest run` passes all decay math tests: `levelFromMs(0, 'normal') === 0.0`; `levelFromMs(2500, 'normal')` is approximately 0.25 (±0.03); `levelFromMs(5000, 'normal') === 1.0`; the curve is strictly increasing.
- [ ] PASS iff switching intensity from `brutal` to `gentle` in the settings panel causes `full_decay_ms` to triple (manual: observe that full decay now takes ~8s instead of ~2s).
- [ ] PASS iff the SQLite session row reflects the updated intensity after `set_intensity` is called.
- [ ] PASS iff pasting a 500-word block into the editor causes the canvas to re-sync word positions within approximately 1 animation frame (no persistent offset artifacts).
- [ ] PASS iff Cmd+Z (undo) causes the canvas to re-sync immediately with no stale word positions.
- [ ] PASS iff a window resize causes the canvas to re-cover the editor with no gap or overflow (same as Phase 1 baseline, maintained under the new MutationObserver/ResizeObserver code).
- [ ] PASS iff `pnpm vitest run` exits 0.
- [ ] PASS iff `cargo test` exits 0.

FAIL on any unchecked box → fix before advancing to Phase 3.
