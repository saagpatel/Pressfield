# Pressfield

## Overview
Local-first Tauri 2 desktop writing app where prose physically decays during idle time — fonts corrupt, glyph edges bleed, words drift, opacity fades — punishing every pause with typographic entropy. The adversarial posture is the product. Single-window, zero network, fully local. The underlying text is never destroyed in v1; decay is a recoverable visual distortion only.

## Tech Stack
- Tauri 2 + Rust (idle timer, decay state machine, SQLite via rusqlite, IPC)
- React 18 + Vite 5 + TypeScript (editor surface, Canvas 2D overlay, UI)
- Canvas 2D: overlay layer rendering decay distortion atop contenteditable
- rusqlite (Rust-native, bundled SQLite) for session history and stats
- Vitest for frontend unit tests; `cargo test` for Rust unit tests

## Development Conventions
- Rust: errors via `thiserror` — no `unwrap()` in non-test code; `anyhow` for binary entry points.
- IPC: Tauri commands emit typed events (`DecayUpdate { level, ms_idle }`); never raw JSON blobs.
- Canvas: all decay rendering isolated in `src/canvas/decay.ts` — no decay logic in React components.
- TypeScript: `unknown` + narrowing over `any`; string-literal unions for decay state (`"idle" | "decaying" | "critical" | "reset"`).
- Conventional commits: feat:, fix:, chore:. Small logical units. Feature branches only.

## CC Infrastructure
This project inherits the global CC setup: 34+ skills, agents, hooks, and MCP plugins.
Project-specific overrides only — see IMPLEMENTATION-ROADMAP.md for architecture.

## Current Phase
**Phase 0: Tauri 2 Scaffold + Rust Idle Timer + IPC + SQLite Session Store**
See IMPLEMENTATION-ROADMAP.md for full phase details.

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| SQLite layer | `rusqlite` (Rust, bundled) | Same process as idle timer; avoids TS↔Rust round-trips for writes; `better-sqlite3` can't see Rust state directly |
| Decay v1 posture | Recoverable visual distortion only | Adversarial feel without real data loss; removes legal/UX risk of accidental destruction |
| Hardcore mode | Deferred to v2, toggle OFF by default | Permanent text loss is a separate ethical and UX contract — don't ship it incidentally |
| Canvas strategy | Overlay atop contenteditable, not replacement | Native text editing for free (selection, IME, undo); Canvas owns rendering only |
| Decay reset trigger | Any keystroke resets idle timer and fades distortion | Simplest feedback loop; keeps the adversarial contract legible |

## Phase-Boundary Review
At the end of every phase, run `/ultrareview` before committing the phase-final code. Do not skip on phases that feel small.

## Do NOT
- Do not implement hardcore mode (permanent text loss) — it is explicitly deferred to v2.
- Do not make any outbound network calls — Pressfield is zero-network, local-only.
- Do not put decay rendering logic inside React components — all Canvas distortion lives in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust code — propagate errors with `?` and `thiserror`.

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Local-first Tauri 2 desktop writing app where prose physically decays during idle time — fonts corrupt, glyph edges bleed, words drift, opacity fades — punishing every pause with typographic entropy. The adversarial posture is the product. Single-window, zero network, fully local. The underlying text is never destroyed in v1; decay is a recoverable visual distortion only.

## Current State

**Phase 0: Tauri 2 Scaffold + Rust Idle Timer + IPC + SQLite Session Store**
See IMPLEMENTATION-ROADMAP.md for full phase details.

## Stack

- Tauri 2 + Rust (idle timer, decay state machine, SQLite via rusqlite, IPC)
- React 18 + Vite 5 + TypeScript (editor surface, Canvas 2D overlay, UI)
- Canvas 2D: overlay layer rendering decay distortion atop contenteditable
- rusqlite (Rust-native, bundled SQLite) for session history and stats
- Vitest for frontend unit tests; `cargo test` for Rust unit tests

## How To Run

- Review the README and top-level scripts before the next session; this repo does not yet expose one canonical run command inside the new context block.

## Known Risks

- Do not implement hardcore mode (permanent text loss) — it is explicitly deferred to v2.
- Do not make any outbound network calls — Pressfield is zero-network, local-only.
- Do not put decay rendering logic inside React components — all Canvas distortion lives in `src/canvas/decay.ts`.
- Do not use `unwrap()` or `expect()` in non-test Rust code — propagate errors with `?` and `thiserror`.

## Next Recommended Move

Use this context plus the README and supporting docs to resume the next active task, then promote the repo beyond minimum-viable by capturing a dedicated handoff, roadmap, or discovery artifact.

<!-- portfolio-context:end -->
