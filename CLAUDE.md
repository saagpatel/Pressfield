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

## CC Infrastructure

This project inherits the global CC setup: skills, agents, hooks, and MCP plugins. Project-specific overrides live here and in `IMPLEMENTATION-ROADMAP.md`.

## Current Phase

**v2 Arc 2: Hardcore Mode is code-complete, live-validated, human-signoff passed, and green on `feat/v2-hardcore`.**

Arc 1 delivered:

- P4: `documents` table, v1-to-v2 migration, document CRUD over IPC, per-document stats.
- P5: autosave, active-document bootstrap, launch hydration, close-to-reopen prose survival.
- P6: Cmd+O command palette for switching, creating, renaming, and deleting documents.

Arc 2 delivered:

- P7: backend hardcore kill switch, persistence, focus-aware idle clock, and bite cadence.
- P8: frontend destructive bite consequence, synchronous flush, one-time confirm, and contract tests.
- P9: live Tauri validation plus final human typing pass. Operator reported **Pass** on 2026-06-07.

## Next Recommended Move

Do a final release-readiness sweep if packaging or distribution is next. Otherwise, pick the next product arc from `IMPLEMENTATION-ROADMAP.md` rather than reopening the completed hardcore contract.

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| SQLite layer | `rusqlite` (Rust, bundled) | Same process as idle timer and app persistence; avoids unnecessary TS-to-Rust database ownership |
| Decay v1/Arc 1 posture | Recoverable visual distortion only | Adversarial feel without accidental data loss |
| Arc 1 storage | `documents.body` in SQLite | Persistence makes Pressfield usable for real prose and consciously retires the v1 "never prose" invariant |
| Autosave posture | Persist clean `innerText` | Decay remains a canvas overlay, so saved prose is clean in Arc 1 |
| Document UX | Cmd+O command palette | Keyboard-first document switching without cluttering the writing surface |
| Hardcore mode | In scope (Arc 2) per `specs/arc2-hardcore.md` — discrete trailing destruction past full decay; opt-in, global, OFF by default | Permanent text loss is an explicit, operator-approved ethical/UX contract |
| Canvas strategy | Overlay atop `contenteditable`, not replacement | Native editing, selection, IME, and undo remain browser-owned |

## Phase-Boundary Review

At the end of every phase or arc, run `/ultrareview` before committing the phase-final code. Do not skip on phases that feel small.

## Do NOT

- Do not implement hardcore mode except as specified in `specs/arc2-hardcore.md` — opt-in, global, OFF by default, and only with the per-bite synchronous flush + undo-defeat in place.
- Do not make outbound network calls; Pressfield is zero-network and local-only.
- Do not put decay rendering logic inside React components; all Canvas distortion lives in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust code; propagate errors with `?` and `thiserror`.
- Do not use scripted keystroke injection for live visual verification; it can leak input into the wrong window. Use screenshots or hand control to the operator.

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Local-first Tauri 2 desktop writing app where prose visibly decays during idle time. The app is deliberately adversarial, but v1 and Arc 1 keep decay non-destructive: the visual layer decays, while clean prose is persisted locally.

## Current State

v2 Arc 2 hardcore mode is code-complete, live-validated, human-signoff passed, and green on `feat/v2-hardcore`. It added opt-in global hardcore mode with one-time confirmation, discrete trailing destruction bites, synchronous save flush, and undo-resistance validation.

## Stack

- Tauri 2 + Rust
- React 19 + Vite 7 + TypeScript
- Canvas 2D
- SQLite via `rusqlite`
- Vitest and cargo tests

## How To Run

- `pnpm install`
- `pnpm tauri dev`
- `pnpm vitest run`
- `pnpm tsc --noEmit`
- `pnpm vite build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo tauri build`

## Known Risks

- Arc 1 persistence still has an older deferred visual-pass note in `ARC2-HANDOFF.md`; do not confuse that with Arc 2 hardcore signoff, which is now passed.
- Hardcore mode intentionally changes the app's data-loss contract; keep the opt-in UX, OFF-by-default posture, synchronous flush, and undo-resistance checks intact.
- The app must stay zero-network and local-only.

## Next Recommended Move

Run a release-readiness sweep if packaging/distribution is next, or choose the next product arc from `IMPLEMENTATION-ROADMAP.md`.

<!-- portfolio-context:end -->
