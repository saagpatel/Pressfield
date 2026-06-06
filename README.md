# Pressfield

Pressfield is a local-first macOS writing app where prose visibly decays while you idle. Fonts corrupt, glyph edges bleed, words drift, opacity fades, and the distortion clears when you start typing again. The adversarial loop is the product.

The app is built with Tauri 2, Rust, React, TypeScript, Vite, and SQLite via `rusqlite`. It is zero-network by product contract: no telemetry, no sync, no cloud.

## Current State

v2 Arc 1, persistence, is code-complete on `feat/v2-persistence` at `660816a`.

Arc 1 delivered:

- P4: `documents` table, `PRAGMA user_version` v1-to-v2 migration, document CRUD over IPC, per-document stats.
- P5: autosave, launch hydration, close-to-reopen prose survival, active-document session binding.
- P6: Cmd+O command palette for switching, creating, renaming, and deleting named documents.

Latest reported gates:

- `cargo test --manifest-path src-tauri/Cargo.toml`: 32 tests passing.
- `pnpm vitest run`: 57 tests passing.
- `pnpm tsc --noEmit`: clean.
- `pnpm vite build`: clean.
- `cargo tauri build`: release app and DMG produced.

Outstanding Arc 1 caveat:

- The operator visual walkthrough is not yet human-confirmed: type, close, reopen, switch documents, confirm per-document text/history, and check both themes.

## Next Arc

Arc 2 is hardcore mode planning. It must start with design, not code.

Hardcore mode would permanently destroy text after decay crosses a threshold, which reverses the v1/Arc 1 invariant that decay is visual and non-destructive. Before implementation, resolve the save/decay contract: whether autosave persists destroyed text, preserved original text, or a deliberately consented irreversible state.

See `ARC2-HANDOFF.md` before touching Arc 2.

## Commands

Install dependencies:

```bash
pnpm install
```

Run the web shell:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm tauri dev
```

Run frontend checks:

```bash
pnpm vitest run
pnpm tsc --noEmit
pnpm vite build
```

Run Rust checks:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Build the desktop bundle:

```bash
cargo tauri build
```

## Guardrails

- Do not add outbound network behavior.
- Do not put decay rendering logic in React components; keep Canvas distortion in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust.
- Do not implement hardcore mode until the Arc 2 design contract is explicit, opt-in, and OFF by default.
- Do not use scripted keystroke injection for visual verification; use screenshots or hand control to the operator.
