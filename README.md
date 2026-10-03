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

## Development and verification

Run all commands below from the repository root. CI uses Node.js 22 and pnpm 10;
use those versions to reproduce its environment. The repository does not declare
support for other versions. Install the locked frontend dependencies:

```bash
pnpm install --frozen-lockfile
```

Rust checks and native development also require Rust/Cargo and the
[Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).
For macOS desktop development, install Xcode Command Line Tools. Linux test
prerequisites are listed in [.github/workflows/ci.yml](.github/workflows/ci.yml).
The app targets macOS; a green Linux CI run does not verify macOS packaging.

For a small local fixture check, run a focused frontend file or Rust test:

```bash
pnpm test src/__tests__/wordCount.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml round_trip_session_with_keystrokes
```

The frontend tests use Node or happy-dom and mock native IPC where needed. Rust
store tests use in-memory databases, with one WAL test using a temporary file;
these test commands do not launch the app or open the user's prose database.
Choose the affected test file or Rust name filter when changing another area.

For the broader local checks:

```bash
pnpm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm exec tsc --noEmit
pnpm build
```

`pnpm build` runs TypeScript and the Vite production build. CI runs the frontend
and Rust tests plus TypeScript; it does not build a desktop bundle. No dedicated
lint or format script is configured. The test counts above are historical
receipts, not assertions about the current checkout.

For UI changes, inspect the changed behavior in the web shell as applicable:

```bash
pnpm dev
```

Vite uses port 1420 and fails if it is occupied. The web shell has no native Tauri
IPC; browser-only checks cannot verify persistence, native events or desktop
close/reopen behavior. Verify those behaviors in the native app when relevant:

```bash
pnpm tauri dev
```

Native runs write to `~/.pressfield/pressfield.db`. Use a disposable OS account
and scratch documents for desktop/manual checks; keep hardcore mode OFF unless
specifically testing its opt-in destruction contract on disposable text. For
editor, persistence or theme changes, manually check type/close/reopen, document
switching and both themes. Use screenshots or hand control, not scripted
keystroke injection. Pure documentation changes do not require a browser pass.

Desktop packaging is a separate, optional macOS release lane:

```bash
pnpm tauri build
```

This uses the repository's npm Tauri CLI and the configured macOS signing
identity; it is not a routine smoke check. For distribution, follow the current
release references in [CLAUDE.md](CLAUDE.md#distribution-closeout-2026-08-24-foundation-zero-milestone-c)
and [RELEASE-NOTES-0.1.0.md](RELEASE-NOTES-0.1.0.md).

## Guardrails

- Do not add outbound network behavior.
- Do not put decay rendering logic in React components; keep Canvas distortion in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust.
- Do not implement hardcore mode until the Arc 2 design contract is explicit, opt-in, and OFF by default.
- Do not use scripted keystroke injection for visual verification; use screenshots or hand control to the operator.
