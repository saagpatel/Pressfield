# Pressfield

Local-first Tauri 2 desktop writing app where prose physically decays during idle time: fonts corrupt, glyph edges bleed, words drift, opacity fades, and every pause becomes visible. The adversarial posture is the product. Single-window, zero-network, fully local.

Decay stays non-destructive through v2 Arc 1: Canvas distortion changes what the user sees while the underlying editor text remains clean. Arc 1 persists that clean prose in SQLite documents, so text survives close and reopen.

## Stack

- Tauri 2 + Rust (idle timer, decay state machine, SQLite via `rusqlite`, IPC)
- React 19 + Vite 7 + TypeScript (editor surface, Canvas 2D overlay, UI)
- Canvas 2D overlay for decay distortion atop `contenteditable`
- `rusqlite` for sessions, documents, document bodies, and stats
- Vitest for frontend tests; `cargo test` for Rust tests

Install, dev, test, and bundle commands live in the Portfolio Context block below.

## Conventions

- Rust: surface errors via `thiserror` and propagate with `?`; keep `unwrap()` and `expect()` to test code.
- IPC: Tauri commands emit typed events and structs, never raw JSON blobs.
- Canvas: all decay math and rendering stay isolated in `src/canvas/decay.ts`. React may orchestrate state but keeps decay rendering out of components.
- TypeScript: prefer `unknown` plus narrowing over `any`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`), small logical units, feature branches only.
- Pressfield is zero-network and local-only: keep outbound network calls out of the app.
- Hardcore mode ships only as specified in `specs/arc2-hardcore.md` — opt-in, global, OFF by default, and only with the per-bite synchronous flush plus undo-defeat in place.
- Verify live visuals with screenshots; scripted keystroke injection is unreliable for this surface.

## State

v2 Arc 2 (Hardcore Mode) is code-complete, live-validated, and signed off on `feat/v2-hardcore`.

- Arc 1 — P4: `documents` table, v1-to-v2 migration, document CRUD over IPC, per-document stats. P5: autosave, active-document bootstrap, launch hydration, close-to-reopen prose survival. P6: Cmd+O command palette for switching, creating, renaming, and deleting documents.
- Arc 2 — P7: backend hardcore kill switch, persistence, focus-aware idle clock, and bite cadence. P8: frontend destructive bite consequence, synchronous flush, one-time confirm, and contract tests. P9: live Tauri validation plus final human typing pass.

## Distribution (closeout 2026-08-24, Foundation Zero Milestone C)

v0.1.0 is publicly distributed: signed (Developer ID), Apple-notarized, stapled, Gatekeeper-accepted, published at https://github.com/saagpatel/Pressfield/releases/tag/v0.1.0 with byte-verified provider readback (DMG sha256 `438d5bbd…719d`) and the full distribution receipt attached as `receipt-0.1.0.json`. Released from commit `0aca35b` on `feat-distkit-consume`. Source provenance closed: the release line landed on `main` via PRs #19/#20, and tag `v0.1.0` is reachable from `origin/main`. No pending distribution action, and no blocking distribution defect known.

- Release path: `~/Projects/distribution-kit/lanes/macos.sh ./distkit.macos.config.sh` (config in this repo). This supersedes `scripts/notarize-release.sh` for releases; that script's keychain-profile auth was never provisioned. The working credentials are the App Store Connect API key (`AuthKey_6NPVH55ZWG.p8`) plus issuer ID in the Keychain (`asc-radar`/`issuer_id`), which the kit reads at runtime.
- Independent consumer proof (a stranger's clean Mac opening the DMG) is UNKNOWN — no clean consumer environment was available. Local Gatekeeper assessment and Apple's notarization acceptance are the strongest layers held.

## Next Recommended Move

For product work, pick Arc 3 (custom decay-curve editor) from `IMPLEMENTATION-ROADMAP.md` rather than reopening the completed hardcore contract. For the next release, bump `version` in `src-tauri/tauri.conf.json` + `DK_VERSION`/`DK_TAG`/`DK_DMG_PATH` in `distkit.macos.config.sh`, then run the kit lane.

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| SQLite layer | `rusqlite` (Rust, bundled) | Same process as idle timer and app persistence; avoids unnecessary TS-to-Rust database ownership |
| Decay v1/Arc 1 posture | Recoverable visual distortion only | Adversarial feel without accidental data loss |
| Arc 1 storage | `documents.body` in SQLite | Persistence makes Pressfield usable for real prose and consciously retires the v1 "never prose" invariant |
| Autosave posture | Persist clean `innerText` | Decay remains a canvas overlay, so saved prose is clean in Arc 1 |
| Document UX | Cmd+O command palette | Keyboard-first document switching without cluttering the writing surface |
| Hardcore mode | In scope (Arc 2) per `specs/arc2-hardcore.md` — discrete trailing destruction past full decay; opt-in, global, OFF by default | Permanent text loss is an explicit, approved ethical/UX contract |
| Canvas strategy | Overlay atop `contenteditable`, not replacement | Native editing, selection, IME, and undo remain browser-owned |

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Local-first Tauri 2 desktop writing app where prose physically decays during idle time: fonts corrupt, glyph edges bleed, words drift, opacity fades, and every pause becomes visible. The adversarial posture is the product. Single-window, zero-network, fully local.

v1 and v2 Arc 1 keep decay non-destructive: Canvas distortion changes what the user sees, while the underlying editor text remains clean. v2 Arc 1 now persists that clean prose in SQLite documents so text survives close and reopen.

## Current State

**v2 Arc 2: Hardcore Mode is code-complete, live-validated, and signed off on `feat/v2-hardcore`.**

Arc 1 delivered:

- P4: `documents` table, v1-to-v2 migration, document CRUD over IPC, per-document stats.
- P5: autosave, active-document bootstrap, launch hydration, close-to-reopen prose survival.
- P6: Cmd+O command palette for switching, creating, renaming, and deleting documents.

Arc 2 delivered:

- P7: backend hardcore kill switch, persistence, focus-aware idle clock, and bite cadence.
- P8: frontend destructive bite consequence, synchronous flush, one-time confirm, and contract tests.
- P9: live Tauri validation plus final human typing pass.

## Stack

- Tauri 2 + Rust (idle timer, decay state machine, SQLite via `rusqlite`, IPC)
- React 19 + Vite 7 + TypeScript (editor surface, Canvas 2D overlay, UI)
- Canvas 2D overlay for decay distortion atop `contenteditable`
- `rusqlite` for sessions, documents, document bodies, and stats
- Vitest for frontend tests; `cargo test` for Rust tests

## How To Run

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

## Known Risks

- Do not implement hardcore mode except as specified in `specs/arc2-hardcore.md` — opt-in, global, OFF by default, and only with the per-bite synchronous flush + undo-defeat in place.
- Do not make outbound network calls; Pressfield is zero-network and local-only.
- Do not put decay rendering logic inside React components; all Canvas distortion lives in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust code; propagate errors with `?` and `thiserror`.
- Do not use scripted keystroke injection for live visual verification; use screenshots instead.

## Next Recommended Move

For distribution, finish notarization using `RELEASE-READINESS.md`. For product work, pick Arc 3 (custom decay-curve editor) from `IMPLEMENTATION-ROADMAP.md` rather than reopening the completed hardcore contract.

<!-- portfolio-context:end -->
