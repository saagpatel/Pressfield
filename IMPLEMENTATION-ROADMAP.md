# Pressfield — Implementation Roadmap

Full architecture + phased build plan. CLAUDE.md is identity; this is the build reference. Source of truth for decisions: `IMPLEMENTATION-PLAN.md` (Sections 1–6).

## Architecture

### System Overview

```
  RUST PROCESS (Tauri backend)               WEBVIEW PROCESS (React frontend)
  ────────────────────────────               ────────────────────────────────

  keydown ─IPC invoke─► record_keystroke     [ contenteditable editor ]
                              │                          │
                              ▼                          │ keydown → invoke("record_keystroke")
                        [ IdleTimer ]                    │
                        std::thread 100ms tick           ▼
                        ms_idle counter            [ useDecayEvents.ts ]
                              │                    interpolates level at 60fps
                              ▼                          │
                        [ DecayState ]                   ▼
                        decay_level: f32 0.0–1.0  [ DecayCanvas.tsx ]
                        intensity: Gentle|Normal|  absolute overlay
                                   Brutal          pointer-events: none
                              │                          │
                              ├──emit decay-update──►    ▼
                              │                    [ decay.ts :: DecayRenderer ]
                              ▼                    baseline drift, blur, word drift,
                        [ SessionStore ]           chromatic fringe
                        rusqlite sessions /
                        keystrokes /               [ StatsPanel.tsx ] (Phase 3)
                        decay_events               reads get_stats IPC command
                              │
                              ▼
                    ~/.pressfield/pressfield.db
```

Both the idle timer reset and the session write happen in the same Rust process. The frontend holds no decay state — it only consumes `DecayUpdate` events and renders them. Resuming typing fires `record_keystroke`, which resets `ms_idle` to 0 in the Rust timer; the next `DecayUpdate` will carry `level = 0.0`.

### File Structure

```
Pressfield/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri app builder; wires commands + idle thread
│   │   ├── idle_timer.rs        # IdleTimer: ms_idle counter, 100ms tick, reset()
│   │   ├── decay.rs             # DecayState: level(ms_idle, intensity); Intensity enum
│   │   ├── session_store.rs     # rusqlite: sessions, keystrokes, decay_events tables
│   │   ├── commands.rs          # #[tauri::command] handlers
│   │   ├── error.rs             # thiserror error types
│   │   └── schema.sql           # embedded via include_str!; CREATE TABLE IF NOT EXISTS
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.tsx                 # React entry; mounts App
│   ├── App.tsx                  # root layout: Editor + DecayCanvas + panels
│   ├── components/
│   │   ├── Editor.tsx           # contenteditable; fires record_keystroke on keydown
│   │   ├── DecayCanvas.tsx      # Canvas overlay; pointer-events: none
│   │   ├── StatsPanel.tsx       # session stats sidebar (Phase 3)
│   │   └── SettingsPanel.tsx    # intensity selector + deferred hardcore toggle (Phase 2)
│   ├── canvas/
│   │   └── decay.ts             # DecayRenderer: all Canvas 2D distortion logic
│   ├── hooks/
│   │   ├── useDecayEvents.ts    # listens for decay-update; interpolates level at 60fps
│   │   └── useSessionStats.ts   # polls get_stats; returns SessionStats
│   ├── utils/
│   │   ├── wordCount.ts         # Intl.Segmenter word counter
│   │   └── decayMath.ts         # levelFromMs(), interpolate() — pure, tested
│   ├── types/
│   │   └── ipc.ts               # DecayUpdate, SessionStats, Intensity TS types
│   └── styles/
│       └── app.css              # CSS custom property tokens; dark default
├── src/__tests__/
│   ├── wordCount.test.ts
│   ├── decayMath.test.ts
│   └── ipcTypes.test.ts
├── specs/
│   ├── phase-0-validation.md
│   ├── phase-1-validation.md
│   ├── phase-2-validation.md
│   └── phase-3-validation.md
├── progress.json
├── tests.json
├── package.json
├── vite.config.ts
├── tsconfig.json
└── CLAUDE.md
```

### Data Model

```sql
-- src-tauri/src/schema.sql (embedded via include_str! in session_store.rs)

CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at   INTEGER NOT NULL,   -- unix ms
    ended_at     INTEGER,            -- NULL while active
    word_count   INTEGER NOT NULL DEFAULT 0,
    decay_events INTEGER NOT NULL DEFAULT 0,  -- pauses > 5s recovered from
    intensity    TEXT NOT NULL       -- 'gentle' | 'normal' | 'brutal'
);

CREATE TABLE IF NOT EXISTS keystrokes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts         INTEGER NOT NULL   -- unix ms of keystroke
);

CREATE TABLE IF NOT EXISTS decay_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    started_at   INTEGER NOT NULL,  -- unix ms when idle exceeded threshold
    recovered_at INTEGER,           -- unix ms when typing resumed; NULL if session ended mid-decay
    peak_level   REAL NOT NULL      -- max decay_level reached before recovery
);

CREATE INDEX IF NOT EXISTS idx_keystrokes_session ON keystrokes(session_id);
CREATE INDEX IF NOT EXISTS idx_decay_session       ON decay_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started    ON sessions(started_at DESC);
```

### Type Definitions

```rust
// src-tauri/src/decay.rs

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Intensity { Gentle, Normal, Brutal }

impl Intensity {
    pub fn full_decay_ms(&self) -> u64 {
        match self {
            Intensity::Gentle => 8_000,
            Intensity::Normal => 5_000,
            Intensity::Brutal => 2_000,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DecayUpdate {
    pub level: f32,       // 0.0 (clear) → 1.0 (full decay)
    pub ms_idle: u64,     // raw ms since last keystroke
    pub intensity: Intensity,
}
```

```typescript
// src/types/ipc.ts

export type Intensity = "gentle" | "normal" | "brutal";
export type DecayState = "idle" | "decaying" | "critical" | "reset";

export interface DecayUpdate {
  level: number;      // 0.0–1.0
  ms_idle: number;
  intensity: Intensity;
}

export interface SessionStats {
  session_id: number;
  started_at: number; // unix ms
  word_count: number;
  decay_events: number;
  intensity: Intensity;
}
```

### IPC Contracts

**Commands (frontend → Rust):**

| Command | Payload | Return | Purpose |
|---------|---------|--------|---------|
| `record_keystroke` | `{ session_id: number }` | `void` | Resets idle timer; logs keystroke row |
| `get_stats` | `{ session_id: number }` | `SessionStats` | Returns session stats from SQLite |
| `set_intensity` | `{ intensity: Intensity }` | `void` | Updates decay rate; persists in session row |
| `end_session` | `{ session_id: number, word_count: number }` | `void` | Closes session row |
| `export_text` | `{ text: string }` | `void` | Writes text to clipboard via Tauri clipboard API |
| `get_recent_sessions` | `{ limit: number }` | `SessionStats[]` | Last N sessions for history panel |

**Events (Rust → frontend):**

| Event | Payload | Frequency | Purpose |
|-------|---------|-----------|---------|
| `decay-update` | `DecayUpdate` | ~10 Hz | Live decay level for Canvas animation |

### Dependencies

```bash
# Rust (src-tauri/Cargo.toml)
cargo add rusqlite --features bundled   # 0.31+
cargo add thiserror                      # 1.0+
cargo add anyhow                         # 1.0+
cargo add serde --features derive        # 1.0+
cargo add serde_json                     # 1.0+

# Tauri CLI
cargo install tauri-cli --version "^2"

# Frontend
pnpm add react@^18 react-dom@^18
pnpm add @tauri-apps/api@^2
pnpm add -D vite@^5 @vitejs/plugin-react typescript@^5.5 vitest@^2 @tauri-apps/cli@^2

# System
brew install node   # 20 LTS+
brew install pnpm   # 9+
# rustup stable
xcode-select --install
```

## Scope Boundaries

**In scope (v1):** contenteditable editor, Canvas 2D decay overlay (baseline drift + blur + word drift + chromatic fringe), Rust idle timer + decay state, IPC `DecayUpdate` events, intensity setting (gentle/normal/brutal), rusqlite session history, stats sidebar, clean text export, dark + light themes, inert hardcore toggle scaffold.

**Out of scope (v1):** Actual text mutation / deletion, hardcore mode wired to a code path, cloud sync, multi-window, document persistence (text is in-memory only), any outbound network call.

**Deferred to v2:** Hardcore mode (text permanently lost when decayed beyond threshold); document autosave; multiple named documents; custom decay curve editor.

## Security and Credentials

- **No credentials** — Pressfield authenticates nothing; no secrets anywhere in the system.
- **Zero network** — no outbound calls; Vite HMR is loopback-only and absent from production builds.
- **Prose never persisted** — the `contenteditable` text never reaches Rust, never touches SQLite, and is never written to disk by Pressfield. SQLite holds only counts and timestamps.
- **Encryption:** None in v1; FileVault covers the DB. Deliberate decision to preserve simplicity.
- **IPC trust:** Tauri 2 capability system limits exposed commands to `commands.rs` surface only.

---

## Phase 0: Tauri 2 Scaffold + Rust Idle Timer + IPC + SQLite Session Store (Week 1, first half)

**Objective:** Verified Tauri 2 toolchain; Rust `IdleTimer` emitting `DecayUpdate` at 100 ms; `record_keystroke` command resets timer and logs to SQLite; `rusqlite` session store round-trips; React editor shell with IPC wiring (no Canvas). `progress.json` + `tests.json` written.

**Tasks:**
1. Scaffold Tauri 2 project (React/Vite/TypeScript template); verify toolchain — Acceptance: `cargo tauri dev` → window opens; `cargo test` exits 0; `pnpm vitest run` exits 0.
2. `src-tauri/src/idle_timer.rs` — `std::thread` 100 ms tick, `ms_idle` counter, `reset()` → emits `decay-update` event on app handle — Acceptance: console shows `decay-update` at ~10 Hz; `ms_idle` increments by ~100 per event when idle.
3. `record_keystroke` Tauri command — resets `IdleTimer`, logs keystroke row — Acceptance: typing causes next `ms_idle` to be < 200; SQLite gains a `keystrokes` row.
4. `src-tauri/src/session_store.rs` — `rusqlite` bundled, embedded schema.sql migration, `start_session` / `end_session` / `record_keystroke` / `get_stats` — Acceptance: `cargo test -- session_store` passes round-trip (3 keystrokes, end session, stats correct).
5. React `Editor.tsx` (bare contenteditable) + `useDecayEvents.ts` (log to console, no Canvas) — Acceptance: keystrokes invoke `record_keystroke`; `decay-update` events appear in console.
6. Write `progress.json` + `tests.json` — Acceptance: both valid JSON; Phase 0 tasks "done".

**Verification checklist:**
- [ ] `cargo tauri dev` → window opens, no console errors
- [ ] `decay-update` logs at ~10 Hz when idle; `ms_idle` increments correctly
- [ ] Typing resets `ms_idle` < 200 ms in next event
- [ ] `cargo test -- session_store` → all pass
- [ ] `pnpm vitest run` → exits 0
- [ ] SQLite DB at `~/.pressfield/pressfield.db` created on first launch
- [ ] `progress.json` + `tests.json` → valid JSON, Phase 0 "done"

**Risks:**
- rusqlite bundled slows cold build: accept one-time cost; fallback → system SQLite (non-bundled).
- IPC throughput at 10 Hz unexpectedly slow: benchmark in Task 2; fallback → 5 Hz with stronger interpolation, or move timer to JS side.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 2 (idle timer), Task 4 (session store) — after Task 1 scaffold.
- Subagent type: coder (Sonnet)
- Rationale: `idle_timer.rs` and `session_store.rs` have no inter-module dependency; both compile against `main.rs` only after scaffold exists.

**Phase-end review:** Run `/ultrareview`. Address all findings before advancing to Phase 1.

---

## Phase 1: Canvas Decay Overlay — First Shippable Checkpoint (Week 1 second half → Week 2)

**Objective:** `DecayCanvas.tsx` (absolute overlay, pointer-events: none) + `src/canvas/decay.ts` `DecayRenderer` (baseline drift, blur/opacity fade) + `useDecayEvents.ts` interpolation at 60 fps. First shippable checkpoint: visible decay on idle, recovery on keystroke.

**Tasks:**
1. `DecayCanvas.tsx` — Canvas absolutely positioned over editor; `ResizeObserver` for window resize — Acceptance: canvas covers editor exactly at 100%/125%/150% zoom; clicks pass through to editor.
2. `src/canvas/decay.ts` `DecayRenderer.render(level, words)` — `globalAlpha` fade, `filter: blur(...)`, baseline translate — Acceptance: `level = 0.0` → transparent; `level = 1.0` → blur ≥ 4px, opacity ≤ 0.2, y-offset ≥ 4px.
3. `useDecayEvents.ts` interpolation — buffers last 2 `DecayUpdate` events; `requestAnimationFrame` interpolation between ticks — Acceptance: no visible discrete jumps between 100ms events; smooth at 60fps.
4. Wire `DecayCanvas` into `App.tsx` — per-frame: query word bounding boxes from editor DOM, call `DecayRenderer.render` — Acceptance: 5s idle (normal) → visible distortion; keystroke → clears within 1 frame.

**Verification checklist:**
- [ ] Canvas covers editor with no pixel offset at 100% and 150% zoom
- [ ] `pointer-events: none` — clicks and keystrokes reach editor through canvas
- [ ] 5 s idle (normal intensity) → visible blur + opacity change
- [ ] Resume typing → canvas clears within ~16 ms
- [ ] `pnpm vitest run` → all pass
- [ ] Window resize → canvas re-covers editor immediately

**Risks:**
- DOM bounding box queries slow on large docs: limit to visible viewport via `IntersectionObserver`; fallback → single full-canvas blur pass.
- High-DPI pixel drift: `canvas.width = rect.width * devicePixelRatio`, scale context; fallback → accept 1px drift.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 2 (`DecayRenderer`), Task 3 (interpolation hook) — both consume `DecayUpdate` from Phase 0 types but share no implementation.
- Subagent type: coder (Sonnet)

**Phase-end review:** Run `/ultrareview`. Address all findings before advancing to Phase 2.

---

## Phase 2: Decay Tuning, Intensity Setting, Word Drift, Robustness (Week 3)

**Objective:** Word drift (pseudorandom per-word lateral drift scaling with level), chromatic aberration fringe (level > 0.5), non-linear decay curve (`levelFromMs` cubic ease-in), `SettingsPanel` intensity selector wired to `set_intensity` IPC, robustness on paste/undo/resize.

**Tasks:**
1. Word drift in `DecayRenderer.render` — Knuth-hash seeded per-word drift vector, max ±12px lateral / ±4px vertical at `level = 1.0` — Acceptance: at `level = 0.8` words visibly diverged; direction consistent across frames.
2. Chromatic aberration — at `level > 0.5`, render word bounding region twice with 2px RGB offset + `screen` blend — Acceptance: faint fringe at `level = 0.7`; prominent at `level = 1.0`.
3. `decayMath.ts` `levelFromMs(ms, intensity)` cubic ease-in — Acceptance: `vitest`: `levelFromMs(0,'normal')=0.0`; `levelFromMs(2500,'normal')≈0.25`; `levelFromMs(5000,'normal')=1.0`; strictly increasing.
4. `SettingsPanel.tsx` intensity radio + `set_intensity` IPC command; Rust updates `DecayState.intensity` and session row — Acceptance: switching `brutal → gentle` triples `full_decay_ms`; next `DecayUpdate` reflects new intensity; session row updated.
5. Robustness: `MutationObserver` invalidates word bounding box cache on paste/undo; `ResizeObserver` on window resizes canvas — Acceptance: paste 500 words → canvas re-syncs within 1 frame; Cmd+Z → re-syncs; resize → no offset.

**Verification checklist:**
- [ ] Word drift visible at `level = 0.8` (normal, ~4s idle)
- [ ] Chromatic fringe visible at `level = 0.7` on light background
- [ ] `levelFromMs(2500,'normal') ≈ 0.25` (vitest)
- [ ] `brutal` → full decay ~2s; `gentle` → ~8s
- [ ] Paste 500 words → canvas re-syncs immediately
- [ ] Window resize → no offset or overflow
- [ ] `pnpm vitest run` + `cargo test` → all pass

**Risks:**
- Drift direction chaos per frame: Knuth hash seed on word index (deterministic); fallback → single global direction.
- Chromatic fringe harsh on dark theme: cap offset to 1px + opacity 0.4; fallback → disable fringe on dark theme.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 1 (word drift), Task 3 (decay curve math).
- Subagent type: coder (Sonnet) for both.

**Phase-end review:** Run `/ultrareview`. Address all findings before advancing to Phase 3.

---

## Phase 3: Stats, Export, Themes, Hardcore Scaffold (Week 4)

**Objective:** `StatsPanel` (live words / decay events / elapsed time + 10-session history), "Copy clean text" export, dark + light theme system, inert hardcore toggle, `cargo tauri build` producing distributable bundle.

**Tasks:**
1. `StatsPanel.tsx` + `useSessionStats.ts` — polls `get_stats` every 5s; local `wordCount` state for real-time display; `get_recent_sessions` for 10-session history table — Acceptance: 3 decay events recovered → panel reads 3; history shows last 10 sessions.
2. `export_text` Tauri command + "Copy clean text" button — sends `contenteditable.innerText` to Rust → clipboard via Tauri clipboard API — Acceptance: decay visible → copy → paste into Notes → clean prose.
3. Theme system — CSS custom property tokens (`--bg`, `--fg`, `--canvas-tint`); dark default + light alternate; selector in settings; `localStorage` persistence — Acceptance: theme switch applies instantly; persists across restart; decay visible on both themes.
4. Hardcore scaffold — inert disabled toggle in `SettingsPanel.tsx`, labelled "Hardcore (coming in v2)"; tooltip explains; no code path connected — Acceptance: toggle renders disabled; clicking does nothing; `vitest` asserts `contenteditable.innerText` unchanged after any decay event.
5. `get_recent_sessions` Tauri command (last 10 sessions from SQLite) wired to history table — Acceptance: 2 test sessions → table shows both with correct word counts, decay events, duration.

**Verification checklist:**
- [ ] Stats panel: live word count, decay events, elapsed time
- [ ] "Copy clean text" → paste → undistorted prose
- [ ] Dark + light themes; decay visible on both; persists across restart
- [ ] Hardcore toggle disabled with v2 tooltip; does nothing
- [ ] `vitest`: contenteditable innerText unchanged after decay event
- [ ] History table: last 10 sessions, correct data
- [ ] `pnpm vitest run` + `cargo test` → all pass
- [ ] `cargo tauri build` → `.dmg` or `.app` bundle produced

**Risks:**
- `get_stats` 5s lag makes word count feel slow: maintain local `wordCount` state in React; push to Rust via `end_session` only.
- Clipboard entitlement: enable `clipboard-read-write` in `tauri.conf.json`; fallback → write to temp file and open in default editor.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 1 (stats panel), Task 3 (theme system), Task 4 (hardcore scaffold) — disjoint UI surfaces.
- Subagent type: coder (Sonnet) for all three.

**Phase-end review:** Run `/ultrareview`. Address all findings. `cargo tauri build` must succeed before marking Phase 3 complete.
