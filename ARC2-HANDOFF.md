# Pressfield — Arc 2 Handoff (hardcore mode)

_Written 2026-06-06 at the end of the v2 Arc 1 (persistence) session._

## Where things stand
- **Branch:** `feat/v2-persistence` · **HEAD:** `660816a` · tree clean.
- **v2 Arc 1 (Persistence) is CODE-COMPLETE & green:** 32 cargo · 57 vitest · tsc clean · `cargo tauri build` produced `Pressfield.app` + `Pressfield_0.1.0_aarch64.dmg`.
- Commits this arc: `905e148` (roadmap) → `9f9b158` + `fab8746` (P4) → `4758b43` (P5) → `660816a` (P6).

## What Arc 1 delivered
- **P4 — Persistence foundation:** `documents` table; `PRAGMA user_version` v1→v2 migration (idempotent, backfills sessions to a seeded "Untitled"); document CRUD over IPC; `sessions.document_id` FK; per-document stats query.
- **P5 — Autosave + active doc:** debounced (750ms) + blur + on-close autosave; launch hydrates the editor from the saved body; `setup()` bootstrap = `apply_migration` → `resolve_active_document` → `start_session_for_document`. **Milestone: close → reopen → prose survives.**
- **P6 — Named documents:** Cmd+O command palette (fuzzy filter, keyboard nav, switch/create/rename/delete); runtime document switching (`switchDocument`, guarded against overlapping runs); per-document stats repoint on switch; `set_intensity` is now session-scoped.

## ⚠️ Outstanding from Arc 1
- **Operator visual pass NOT yet human-confirmed.** Logic is fully tested + the release bundle built + the live bootstrap is verified (process up, DB written at launch), but the human walkthrough (type→close→reopen; palette switching keeps per-doc text+history; both themes) was deferred when we jumped to Arc 2. The Arc 1 checklist lives in `specs/` and `IMPLEMENTATION-ROADMAP.md` (Phase 5/6 verification + operator visual boxes). Decide whether to stamp it before/while building Arc 2.

## Arc 1 LOCKED DECISIONS (do not revisit)
- Prose stored in rusqlite as `documents.body` (retired the v1 "never prose" invariant — comment updated in `schema.sql`).
- Per-document stats: `sessions.document_id` FK; opening a doc starts/resumes its session.
- Doc-switcher UX = Cmd+O command palette (keyboard-first).
- Migration = `user_version`-gated; `documents` is idempotent `CREATE TABLE IF NOT EXISTS`; the `ALTER TABLE sessions ADD COLUMN` runs once for real on-disk v1 DBs (tested via `migration_adds_column_on_real_v1_database`).
- Autosave persists clean `innerText` (decay is canvas-overlay only; underlying text untouched).

## Arc 2 = Hardcore mode (the next arc)
**Definition (roadmap "v2 — Later Arcs"):** text **permanently lost** when decayed past a threshold. Toggle stays **OFF by default**. This is a separate ethical/UX contract, deliberately walled off until now — **start with brainstorm/plan, not code.**

### The central design knot (resolve this FIRST, with the operator)
- v1/Arc1 decay is purely **visual** — the contenteditable always holds clean text, and autosave persists that clean text. Hardcore mode **inverts that core invariant**: past a threshold the underlying text is actually destroyed.
- **The save/decay knot:** autosave persists clean `innerText` on a debounce. If hardcore destroys text, does autosave save the **corpse** (post-destruction) or the **original**? When does destruction become irreversible vs. recoverable-on-keystroke?
- **`textIntegrity.test.ts`** is the v1 "text survives decay" contract (uses happy-dom). Hardcore ON **violates** it. Arc 2 must split the contract: hardcore OFF → text survives (existing guarantee holds); hardcore ON → text is destroyed past threshold (new, tested guarantee).

### Constraint that must be consciously LIFTED (don't violate silently)
- **`CLAUDE.md` currently says "Do NOT implement hardcore mode — deferred to v2"** and lists it as deferred in Key Decisions. Arc 2 IS that work. **First step: with the operator, update `CLAUDE.md`'s "Do NOT" + "Key Decisions" to reflect hardcore is now in-scope (gated, opt-in, OFF by default)** — don't just start coding against a standing prohibition.

### What already exists to build on
- **Inert toggle scaffold** in `src/components/SettingsPanel.tsx` ("Hardcore (coming in v2)", disabled, wired to nothing) — Arc 2 makes it live.
- Decay math is quadratic t² — authoritative in `src-tauri/src/decay.rs::decay_level`, mirrored in `src/canvas/decayMath.ts::levelFromMs`. A destruction threshold would key off `decay_level`/`level`.
- Decay events already recorded server-side (pause >5s → `record_decay_event`); hardcore destruction would be a new, more consequential event type.

## Hard constraints (project CLAUDE.md)
- Zero network — local only.
- No decay logic in React components — all canvas distortion lives in `src/canvas/decay.ts`.
- No `unwrap()`/`expect()` in non-test Rust — propagate with `?` + `thiserror`.
- Rust IPC emits typed events, never raw JSON blobs.
- (The "no hardcore mode" rule is the one to consciously lift for Arc 2 — see above.)

## Workflow notes
- Per-phase rhythm used all arc: plan/brainstorm → solo sequential TDD (red→green→refactor) → `/code-review` (fold fixes in) → mission commit. It worked well — keep it.
- **Do NOT drive the live app via osascript keystroke injection** — it leaks keystrokes into other windows on focus change (`memory/feedback_tauri_visual_verify_osascript.md`). `screencapture` + image-Read is fine for looking; hand keyboard/clicks to the operator.
- Gate per change: `cargo test --manifest-path src-tauri/Cargo.toml`, `pnpm tsc --noEmit`, `pnpm vitest run`, `pnpm vite build`; full bundle `cargo tauri build`.

## Read first
- `IMPLEMENTATION-ROADMAP.md` → "v2 — Later Arcs" (Arc 2 bullet) + the Arc 1 phase checklists.
- `CLAUDE.md` (hard constraints + the hardcore prohibition to lift).
- `src/components/SettingsPanel.tsx` (the inert toggle), `src/__tests__/textIntegrity.test.ts` (the contract to split), `src-tauri/src/decay.rs` + `src/canvas/decayMath.ts` (the threshold source).
