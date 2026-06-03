# Phase 1 Validation — Canvas Decay Overlay (First Shippable Checkpoint)

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff the Canvas element precisely covers the `contenteditable` editor with no pixel offset at 100%, 125%, and 150% browser zoom (measure with DevTools element inspector).
- [ ] PASS iff `pointer-events: none` is confirmed on the Canvas: clicking anywhere on the canvas surface moves the editor cursor, not a canvas selection.
- [ ] PASS iff after 5 seconds of idle time with `normal` intensity, visible blur and opacity change appear on the editor text (manual visual check).
- [ ] PASS iff resuming typing (pressing any key) clears the canvas to fully transparent within approximately 16 ms (one animation frame); no residual distortion persists after 2 keystrokes.
- [ ] PASS iff resizing the window causes the canvas to immediately re-cover the editor with no gap, overflow, or stale offset.
- [ ] PASS iff `pnpm vitest run` exits 0 and all word count and decay math tests pass.
- [ ] PASS iff `DecayRenderer.render` with `level = 0.0` produces a fully transparent canvas (no pixels drawn).
- [ ] PASS iff `DecayRenderer.render` with `level = 1.0` applies blur ≥ 4px, globalAlpha ≤ 0.2, and a y-axis baseline offset ≥ 4px to word regions.

FAIL on any unchecked box → fix before advancing to Phase 2.
