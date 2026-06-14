# Pressfield

## Overview

Local-first Tauri 2 desktop writing app where prose physically decays during idle time: fonts corrupt, glyph edges bleed, words drift, opacity fades, and every pause becomes visible. The adversarial posture is the product. Single-window, zero-network, fully local.

v1 and v2 Arc 1 keep decay non-destructive: Canvas distortion changes what the user sees, while the underlying editor text remains clean. v2 Arc 1 now persists that clean prose in SQLite documents so text survives close and reopen.

## Tech Stack

- Tauri 2 + Rust (idle timer, decay state machine, SQLite via `rusqlite`, IPC)
- React 19 + Vite 7 + TypeScript (editor surface, Canvas 2D overlay, UI)
- Canvas 2D overlay for decay distortion atop `contenteditable`
- `rusqlite` for sessions, documents, document bodies, and stats
- Vitest for frontend tests; `cargo test` for Rust tests

## Development Conventions

- Rust: errors via `thiserror`; no `unwrap()` or `expect()` in non-test code.
- IPC: Tauri commands emit typed events and structs, never raw JSON blobs.
- Canvas: all decay rendering stays isolated in `src/canvas/decay.ts`; React may orchestrate state but must not own decay math/rendering.
- TypeScript: prefer `unknown` plus narrowing over `any`.
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`. Small logical units. Feature branches only.

## Current Phase

**v2 Arc 2: Hardcore Mode is code-complete, live-validated, and signed off on `feat/v2-hardcore`.**

Arc 1 delivered:

- P4: `documents` table, v1-to-v2 migration, document CRUD over IPC, per-document stats.
- P5: autosave, active-document bootstrap, launch hydration, close-to-reopen prose survival.
- P6: Cmd+O command palette for switching, creating, renaming, and deleting documents.

Arc 2 delivered:

- P7: backend hardcore kill switch, persistence, focus-aware idle clock, and bite cadence.
- P8: frontend destructive bite consequence, synchronous flush, one-time confirm, and contract tests.
- P9: live Tauri validation plus final human typing pass.

## Next Recommended Move

For distribution, finish notarization using `RELEASE-READINESS.md`. For product work, pick Arc 3 (custom decay-curve editor) from `IMPLEMENTATION-ROADMAP.md` rather than reopening the completed hardcore contract.

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

## Do NOT

- Do not implement hardcore mode except as specified in `specs/arc2-hardcore.md` — opt-in, global, OFF by default, and only with the per-bite synchronous flush + undo-defeat in place.
- Do not make outbound network calls; Pressfield is zero-network and local-only.
- Do not put decay rendering logic inside React components; all Canvas distortion lives in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust code; propagate errors with `?` and `thiserror`.
- Do not use scripted keystroke injection for live visual verification; use screenshots instead.
