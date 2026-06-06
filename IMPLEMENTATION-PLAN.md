# Pressfield — Implementation Plan

> Historical note, 2026-06-06: this is the original v1 implementation plan. v2 Arc 1 has since
> added local document persistence in SQLite (`documents.body`) so prose now survives close and
> reopen. Treat v1 "content never persisted" language below as historical unless it is explicitly
> restated in `CLAUDE.md`, `README.md`, or `IMPLEMENTATION-ROADMAP.md`.

> A local-first Tauri 2 writing app where prose physically decays during idle time. Typographic entropy punishes every pause — fonts corrupt, glyph edges bleed, words drift, opacity fades — while the underlying text survives intact. The only adversarial creative tool in the operator's 58-project portfolio.

---

## Section 1: EXEC SUMMARY

### 1a. What we're building

Pressfield is a single-window, zero-network macOS desktop app built on Tauri 2 (Rust backend + React/Vite/TypeScript frontend). The user types into a `contenteditable` editing surface. A Rust-side idle timer measures milliseconds since the last keystroke and emits a continuous `DecayUpdate` event over Tauri IPC. A Canvas 2D overlay layer sits atop the editor and reads that decay level to render progressive typographic distortion: baseline drift (glyphs slide off their line), glyph edge bleed (blur + chromatic fringe), word drift (slow lateral translation), and opacity fade. The distortion intensifies as idle time grows. The moment the user resumes typing, the decay resets and the canvas clears back to crisp text.

The underlying `contenteditable` text is **never mutated** in v1. The adversarial feeling is fully present — it looks like the text is disintegrating — without the risk of actual data loss. An intensity setting (`gentle / normal / brutal`) controls how fast the decay accumulates. A "hardcore" mode (where decayed text is permanently committed-as-lost) is deliberately deferred to v2 and off by default even when scaffolded.

Session history (words written per session, decay events survived, duration) persists to local SQLite via `rusqlite` directly in the Rust process. At Phase 3, session stats are surfaced in a sidebar panel, and clean text can be exported.

### 1b. Riskiest parts and de-risking strategy

- **Risk: Canvas 2D text-pixel sync — the overlay must align perfectly with the contenteditable layout or decay distortion looks wrong.**
  - Severity: HIGH
  - Why it is risky: The Canvas overlay covers the editor at the pixel level. `contenteditable` line layout is controlled by the browser engine; fonts, line heights, and word wrap change with window resize, zoom, and OS font smoothing. If the Canvas coordinate system drifts from the rendered text position, glyphs appear to decay in the wrong place, breaking the illusion.
  - Mitigation: Use `getBoundingClientRect()` on each word/span at render time to anchor distortion to actual DOM bounding boxes — never guess text layout. The Canvas layer reads live DOM geometry before each frame.
  - Fallback: If per-word DOM queries are too expensive at 60 fps, batch into 200 ms ticks (the decay animation does not need to be per-frame — it accumulates slowly). A 200 ms tick is imperceptible to the human eye for slow typographic decay.

- **Risk: Rust idle timer accuracy — macOS timer coalescing can batch wake-ups, making the decay level feel jumpy.**
  - Severity: MEDIUM
  - Why it is risky: If the Rust `std::thread::sleep` loop is coalesced by macOS power management, the emitted `DecayUpdate` events may arrive in bursts rather than smoothly, causing the Canvas distortion to lurch rather than drift.
  - Mitigation: Drive the idle timer at 100 ms resolution (10 ticks/sec); smooth the decay level on the JS side with linear interpolation before applying to the Canvas. The frontend holds the last two levels and interpolates between them for every animation frame.
  - Fallback: If Tauri event throughput from Rust at 100 ms is too noisy, drop to a 500 ms emit interval and interpolate more aggressively. The decay effect is slow by design — 500 ms granularity is invisible.

- **Risk: contenteditable word-count accuracy — word count for session stats is nontrivial with rich paste, IME, and emoji.**
  - Severity: MEDIUM
  - Why it is risky: The `input` event on `contenteditable` fires correctly but `innerText.split(/\s+/)` undercount with emoji and overcount with trailing whitespace. Session stats (words written) are a visible metric the user will notice being wrong.
  - Mitigation: Delegate word counting to a TypeScript utility (`src/utils/wordCount.ts`) with an `Intl.Segmenter`-based implementation; unit-test it with emoji, multi-byte, and whitespace fixtures before wiring into the session store.
  - Fallback: Fall back to a `\p{L}+` Unicode regex word splitter (still handles most scripts correctly); document the known edge cases in a `// TODO(v2)` comment.

- **Risk: Tauri 2 IPC event throughput — emitting 10 events/sec from Rust may be slower than expected with the webview bridge.**
  - Severity: LOW
  - Why it is risky: Tauri 2's event bridge involves a JSON-serialized message over the webview IPC channel. At 10 Hz, this is 600 messages/minute — very low for a system channel, but untested in the operator's Tauri experience.
  - Mitigation: Benchmark IPC latency in Phase 0 with a tight emit loop; if P99 > 50 ms at 10 Hz, batch decay level into a single `DecayUpdate` struct that carries both the level (0.0–1.0) and the raw `ms_idle` so the frontend can self-interpolate without asking again.
  - Fallback: Move the idle timer entirely to the JS side (using `performance.now()` delta on `keydown`) and use Rust only for durable session writes. This removes the IPC tick entirely but also removes the "Rust owns idle state" architecture — acceptable as a fallback because the visual effect is the same.

- **Risk: Canvas performance — rendering blur + drift on many words at 60 fps on a large document.**
  - Severity: LOW
  - Why it is risky: If the user has a 5,000-word document open and the canvas distortion applies per-word DOM query + blur filter, frame time could spike above 16 ms.
  - Mitigation: Apply distortion only to the **visible viewport**, not the full document. Use `IntersectionObserver` to identify which words are in view and skip off-screen nodes.
  - Fallback: Apply a single full-canvas blur + opacity pass instead of per-word effects if per-word performance degrades. Less precise, still effective.

### 1c. Shortest path to daily personal use

Ship Phase 0 + Phase 1 by end of week 2. Phase 1 is the first shippable checkpoint: a paragraph visibly decaying on idle with recovery on resume — the core loop is complete. The adversarial effect works; this is already daily-usable as a writing motivator. Phase 2 adds intensity settings and robustness (the feel is tuned, not just functional). Phase 3 rounds out the product with stats, export, and theme polish. At no point is a backend, cloud, or network call required.

---

## Section 2: REVIEW GATE (SPEC LOCK)

### 2a. Goal

A local-first macOS desktop writing app that renders progressive typographic decay on idle, driven by a Rust idle timer over Tauri IPC, with recoverable visual distortion only, local session history in SQLite, and an intensity setting.

### 2b. Success metrics

1. With `normal` intensity, visible Canvas distortion (baseline drift or opacity fade) begins within 3 seconds of the last keystroke; resuming typing clears the distortion within one animation frame (≤16 ms).
2. The decay level emitted by Rust accurately reflects `ms_since_last_keystroke`; a 10-second idle produces a `DecayLevel` of approximately 0.5 with `normal` intensity (calibrated in Phase 2).
3. Session stats persist across app restarts: words written, session duration, and count of "decay events survived" (pauses > 5 s that the user recovered from) stored in SQLite and readable via a query.
4. Intensity settings (`gentle / normal / brutal`) produce measurably different decay onset times: `gentle` → 8 s to full decay; `normal` → 5 s; `brutal` → 2 s.
5. `cargo test` and `pnpm vitest run` both pass on a clean checkout with no manual setup.

### 2c. Hard constraints

1. **Zero network** — Pressfield never makes an outbound call. No telemetry, no sync, no cloud. `127.0.0.1` is the only address that may appear in network code, and only for localhost dev tooling (Vite HMR in dev mode).
2. **Text is never destroyed in v1** — the `contenteditable` DOM is never mutated by the decay system. The Canvas overlay distorts rendering only. Resuming typing always restores full legibility.
3. **Hardcore mode is deferred to v2** — the toggle may be scaffolded (off by default) but must not be wired to any text-mutation path in v1.
4. **Rust owns the decay state** — `ms_since_last_keystroke` and the derived `decay_level` live exclusively in the Rust process; the frontend reads them via IPC events and never computes them independently.
5. **rusqlite in Rust, not better-sqlite3 in Node** — all SQLite writes happen in the Rust process via `rusqlite`. The frontend never opens a database file directly.

### 2d. Locked decisions

- Decision: SQLite layer (rusqlite in Rust vs better-sqlite3 in Node).
  - Locked to: `rusqlite` (Rust, bundled via `rusqlite` feature `bundled`).
  - Rationale: The idle timer and session state live in Rust. Writing to SQLite from the same process eliminates a round-trip through IPC on every keystroke event; `rusqlite` with the `bundled` feature ships SQLite statically so there is no system SQLite version dependency. `better-sqlite3` would require crossing the IPC bridge to write session data, coupling two processes for no benefit.
  - Failure mode: If `rusqlite` bundled compilation slows the `cargo build` cycle significantly (> 60 s cold), switch to system SQLite via `rusqlite` without `bundled`, locking the minimum macOS SQLite version. Schema is unchanged.

- Decision: Decay posture in v1 (visual distortion vs text mutation).
  - Locked to: Recoverable visual distortion only. The Canvas overlay distorts rendering; the `contenteditable` text is never touched.
  - Rationale: Real data loss would make the app unusable as a writing tool for most users; the adversarial feeling is fully achieved visually without the risk. Keeps v1 shippable to anyone.
  - Failure mode: N/A — this is a posture choice, not a technical risk. Hardcore mode (text mutation) is explicitly deferred to v2 with a deferred scaffold.

- Decision: Hardcore mode availability in v1.
  - Locked to: Deferred to v2. May appear as an inert toggle in the settings UI (clearly labelled "coming in v2"), but must not be connected to any text-mutation code path.
  - Rationale: Permanent text loss is a separate ethical and UX contract requiring deliberate opt-in flow, confirmation dialogs, and explicit user education. Shipping it incidentally under a checkbox is a support and trust disaster.
  - Failure mode: N/A — if the toggle is wired accidentally, failing acceptance tests catch it (the contenteditable text must be identical before and after any decay event in v1).

- Decision: Canvas overlay strategy (overlay vs replacement vs CSS filter).
  - Locked to: Absolute-positioned Canvas 2D overlay atop `contenteditable`. The editor and Canvas share the same bounding box; Canvas `z-index` is above the editor; Canvas is `pointer-events: none` so all keyboard and mouse events reach the editor.
  - Rationale: `contenteditable` provides native text editing for free (selection, cursor, IME, undo, clipboard). CSS filters (`blur`, `opacity`) applied to the editor element would interfere with cursor rendering and accessibility. Canvas as a `pointer-events: none` overlay is the standard pattern for games and creative tools that augment a DOM surface.
  - Failure mode: If `pointer-events: none` on the Canvas blocks some platform-specific touch/stylus input, constrain the Canvas z-index and accept slightly worse visual layering.

---

## Section 3: ARCHITECTURE

### 3a. System diagram

```
  RUST PROCESS (Tauri backend)                  WEBVIEW PROCESS (React frontend)
  ─────────────────────────────                 ────────────────────────────────

  [ keydown event ──IPC──► ]                    [ contenteditable editor ]
         │                                               │
         ▼                                               │ DOM keydown (via JS listener)
  [ IdleTimer ]                                          │ fires Tauri invoke("record_keystroke")
  ms_since_last_keystroke                                │
         │                                               ▼
         ▼                                       [ DecayEngine (TS) ]
  [ DecayState ]                                 reads DecayUpdate events
  decay_level: f32 (0.0–1.0)                     interpolates between ticks
  intensity: Gentle|Normal|Brutal                         │
         │                                               ▼
         │──emit DecayUpdate──►               [ Canvas 2D overlay ]
         │                                    reads DOM bounding boxes
         │                                    renders: baseline drift,
         ▼                                    edge bleed, word drift,
  [ SessionStore ]                            opacity fade
  rusqlite: sessions,                                     │
  keystrokes, decay_events                    (pointer-events: none)
         │
         ▼
  ~/.pressfield/pressfield.db
```

### 3b. Tech stack

- **Tauri 2** — the desktop shell; wires Rust backend commands and events to the React frontend over the webview IPC bridge. macOS target, arm64 primary.
- **Rust (stable, 1.80+)** — idle timer thread, decay state machine, SQLite session store, all IPC command handlers. No async runtime needed; the idle timer is a `std::thread` with `std::thread::sleep`.
- **React 18 + Vite 5** — frontend framework + bundler. React for the editor shell, settings panel, and stats sidebar. Vite for HMR in dev.
- **TypeScript 5.5+** — strict mode. `unknown` + narrowing; string-literal unions; no `any`.
- **Canvas 2D API** — browser native; no WebGL, no three.js. All decay rendering is 2D canvas operations: `globalAlpha`, `filter: blur(...)`, `translate`, `drawImage`.
- **rusqlite 0.31+ (bundled feature)** — Rust-native SQLite driver, statically links SQLite. No system SQLite dependency.
- **thiserror 1.0+** — typed error definitions for Rust library crates.
- **anyhow 1.0+** — error propagation in Rust binary entry points.
- **serde + serde_json 1.0+** — JSON serialization for Tauri IPC payload types.
- **Vitest 2.0+** — frontend unit test runner (word count, decay math, IPC payload parsing).
- **`cargo test`** — Rust unit tests for idle timer, decay level calculation, session store round-trips.

### 3c. File structure

```
Pressfield/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                  # Tauri app builder; wires commands + idle thread
│   │   ├── idle_timer.rs            # IdleTimer: ms_since_last_keystroke, 100ms tick thread
│   │   ├── decay.rs                 # DecayState: decay_level from ms_idle + intensity
│   │   ├── session_store.rs         # rusqlite store: sessions, keystrokes, decay_events
│   │   ├── commands.rs              # Tauri #[command] handlers: record_keystroke, get_stats
│   │   ├── error.rs                 # thiserror error types
│   │   └── schema.sql               # embedded via include_str!; DDL for the 3 tables
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.tsx                     # React entry; mounts App
│   ├── App.tsx                      # root layout: Editor + Canvas + Sidebar
│   ├── components/
│   │   ├── Editor.tsx               # contenteditable surface; fires record_keystroke on keydown
│   │   ├── DecayCanvas.tsx          # Canvas element; absolute overlay; pointer-events: none
│   │   ├── StatsPanel.tsx           # session stats sidebar (Phase 3)
│   │   └── SettingsPanel.tsx        # intensity selector + hardcore deferred toggle (Phase 2)
│   ├── canvas/
│   │   └── decay.ts                 # DecayRenderer: all Canvas 2D distortion logic
│   ├── hooks/
│   │   ├── useDecayEvents.ts        # listens for DecayUpdate Tauri events; interpolates level
│   │   └── useSessionStats.ts       # polls get_stats IPC command; returns SessionStats
│   ├── utils/
│   │   ├── wordCount.ts             # Intl.Segmenter word counter; unit-tested
│   │   └── decayMath.ts             # pure fns: levelFromMs(ms, intensity), interpolate()
│   ├── types/
│   │   └── ipc.ts                   # DecayUpdate, SessionStats, Intensity TS types
│   └── styles/
│       └── app.css                  # minimal layout; dark base; no decay CSS here
├── src/__tests__/
│   ├── wordCount.test.ts
│   ├── decayMath.test.ts
│   └── ipcTypes.test.ts
├── specs/
│   ├── phase-0-validation.md
│   ├── phase-1-validation.md
│   ├── phase-2-validation.md
│   └── phase-3-validation.md
├── progress.json                    # phase/task status; created Phase 0
├── tests.json                       # all planned test cases; created Phase 0
├── package.json
├── vite.config.ts
├── tsconfig.json
└── CLAUDE.md
```

### 3d. Data model

```sql
-- src-tauri/src/schema.sql  (embedded via include_str! in session_store.rs)

CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at      INTEGER NOT NULL,   -- unix ms
    ended_at        INTEGER,            -- NULL while active
    word_count      INTEGER NOT NULL DEFAULT 0,
    decay_events    INTEGER NOT NULL DEFAULT 0,  -- pauses > 5s that were recovered
    intensity       TEXT NOT NULL       -- 'gentle' | 'normal' | 'brutal'
);

CREATE TABLE IF NOT EXISTS keystrokes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts          INTEGER NOT NULL        -- unix ms of the keystroke
);

CREATE TABLE IF NOT EXISTS decay_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    started_at      INTEGER NOT NULL,   -- unix ms when decay began (idle > threshold)
    recovered_at    INTEGER,            -- unix ms when typing resumed; NULL if session ended mid-decay
    peak_level      REAL NOT NULL       -- max decay_level (0.0–1.0) reached before recovery
);

CREATE INDEX IF NOT EXISTS idx_keystrokes_session ON keystrokes(session_id);
CREATE INDEX IF NOT EXISTS idx_decay_session       ON decay_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started    ON sessions(started_at DESC);
```

### 3e. Type definitions

```rust
// src-tauri/src/decay.rs

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Intensity {
    Gentle,
    Normal,
    Brutal,
}

impl Intensity {
    /// Milliseconds of idle time that map to decay_level = 1.0
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
    pub level: f32,      // 0.0 (clear) to 1.0 (full decay)
    pub ms_idle: u64,    // raw milliseconds since last keystroke
    pub intensity: Intensity,
}

// src-tauri/src/session_store.rs

#[derive(Debug, serde::Serialize)]
pub struct SessionStats {
    pub session_id: i64,
    pub started_at: i64,
    pub word_count: i64,
    pub decay_events: i64,
    pub intensity: String,
}
```

```typescript
// src/types/ipc.ts

export type Intensity = "gentle" | "normal" | "brutal";

export interface DecayUpdate {
  level: number;       // 0.0–1.0
  ms_idle: number;     // raw ms since last keystroke
  intensity: Intensity;
}

export interface SessionStats {
  session_id: number;
  started_at: number;  // unix ms
  word_count: number;
  decay_events: number;
  intensity: Intensity;
}

// Decay state as a string-literal union (never an enum)
export type DecayState = "idle" | "decaying" | "critical" | "reset";
```

### 3f. IPC contracts

Pressfield makes **zero external network calls**. The only communication surface is between the Tauri Rust backend and the React frontend over the internal webview bridge.

**Tauri Commands (frontend → Rust):**

| Command | Payload | Return | Purpose |
|---------|---------|--------|---------|
| `record_keystroke` | `{ session_id: number }` | `void` | Resets the Rust idle timer; logs a keystroke row |
| `get_stats` | `{ session_id: number }` | `SessionStats` | Returns current session stats from SQLite |
| `set_intensity` | `{ intensity: Intensity }` | `void` | Updates decay rate; persists in session row |
| `end_session` | `{ session_id: number, word_count: number }` | `void` | Closes the session row (sets `ended_at`) |

**Tauri Events (Rust → frontend, emitted on `main` window):**

| Event | Payload | Frequency | Purpose |
|-------|---------|-----------|---------|
| `decay-update` | `DecayUpdate` | ~10 Hz (100 ms tick) | Live decay level for Canvas animation |

### 3g. Dependencies with install commands

```bash
# Rust (add to src-tauri/Cargo.toml)
# rusqlite 0.31+ with bundled SQLite
cargo add rusqlite --features bundled
cargo add thiserror
cargo add anyhow
cargo add serde --features derive
cargo add serde_json

# Tauri CLI (system)
cargo install tauri-cli --version "^2"

# Frontend (npm/pnpm)
pnpm add react@^18 react-dom@^18
pnpm add -D vite@^5 @vitejs/plugin-react typescript@^5.5 vitest@^2
pnpm add @tauri-apps/api@^2
pnpm add -D @tauri-apps/cli@^2

# System toolchain (Homebrew)
brew install rust        # rustup or rustup-init; stable channel
brew install node        # 20 LTS+
brew install pnpm        # 9+
# Xcode Command Line Tools required for macOS target
xcode-select --install
```

---

## Section 4: PHASED IMPLEMENTATION

## Phase 0: Tauri 2 Scaffold + Rust Idle Timer + IPC + SQLite Session Store (Week 1, first half)

### Agent Routing
- Recommended: Claude Code
- Rationale: Interactive scaffolding, Rust wiring, and IPC plumbing — all hands-on implementation where tight feedback loops are needed.
- Note: Phase 0 is the framework context window — write `progress.json`, `tests.json`, and `schema.sql` here; subsequent phases iterate from these artifacts rather than re-deriving project state.

### Objectives
- Verified Tauri 2 toolchain (`cargo tauri --version`, `pnpm` available).
- Rust `IdleTimer` thread emitting `DecayUpdate` events over IPC at 100 ms; reset via `record_keystroke` command.
- `rusqlite` session store with schema migration; `start_session` / `record_keystroke` / `end_session` round-trips.
- React shell (no Canvas, no decay rendering yet): just the `contenteditable` editor wired to `record_keystroke`.
- `progress.json` and `tests.json` at project root.

### Tasks
1. Scaffold Tauri 2 project with React/Vite/TypeScript template; verify toolchain.
   - Context: Establishes the build system before any logic lands.
   - Acceptance: `cargo tauri dev` launches a window with the default Tauri welcome screen; `pnpm vitest run` exits 0 on an empty test suite; `cargo test` exits 0.
2. Implement `src-tauri/src/idle_timer.rs` — spawns a `std::thread` that sleeps 100 ms, increments `ms_idle`, emits `DecayUpdate` event on the Tauri app handle.
   - Context: The decay state machine's clock source; everything downstream reads from this.
   - Acceptance: Console logs in the frontend show `decay-update` events arriving at ~10 Hz with increasing `ms_idle` when no keys are pressed.
3. Wire `record_keystroke` Tauri command — resets the idle timer `ms_idle` to 0 and logs a keystroke row in SQLite.
   - Context: The feedback loop between editor input and the decay engine.
   - Acceptance: Pressing any key in the React editor causes `ms_idle` in the next `DecayUpdate` event to be < 200 ms (reset happened); SQLite `keystrokes` table gains a row.
4. Implement `src-tauri/src/session_store.rs` — `rusqlite` store, embedded `schema.sql` migration, `start_session` / `end_session` / `record_keystroke` / `get_stats`.
   - Context: Persistence layer for session history surfaced in Phase 3 stats.
   - Acceptance: `cargo test -- session_store` passes: round-trip creates a session, records 3 keystrokes, ends session, returns correct `word_count` and `decay_events` = 0.
5. Implement React `Editor.tsx` (bare `contenteditable`) and `useDecayEvents.ts` hook — no Canvas yet, just event logging to console.
   - Context: Locks the editor/IPC wiring before adding Canvas complexity in Phase 1.
   - Acceptance: Keystrokes in the editor trigger `record_keystroke` IPC; `decay-update` events log to console.
6. Write `progress.json` + `tests.json` at root.
   - Context: Session-resume state Claude Code reads first each session.
   - Acceptance: Both files are valid JSON; Phase 0 tasks are marked "done".

### Phase Verification Checklist
- [ ] `cargo tauri dev` → window opens, no console errors
- [ ] `decay-update` events log to console at ~10 Hz when idle
- [ ] Typing resets `ms_idle` to < 200 ms in the next event
- [ ] `cargo test -- session_store` → all pass
- [ ] `pnpm vitest run` → exits 0
- [ ] SQLite DB created at `~/.pressfield/pressfield.db` on first launch
- [ ] `cat progress.json` → valid JSON, Phase 0 tasks "done"
- [ ] `cat tests.json` → valid JSON, all phases listed

### Risks & Mitigations
- Risk: rusqlite bundled feature significantly slows cold `cargo build`.
  - Mitigation: Accept the one-time cost; subsequent incremental builds are fast. If > 3 min, switch to system SQLite (non-bundled `rusqlite`).
  - Fallback: System SQLite on macOS 13+ is 3.39+, sufficient for the schema.
- Risk: Tauri 2 IPC event throughput from Rust at 10 Hz is unexpectedly slow.
  - Mitigation: Benchmark in Task 2 with console timestamps; if P99 > 50 ms, drop to 5 Hz and interpolate more aggressively in the frontend.
  - Fallback: Move idle timer entirely to JS side (risk noted in 1b fallback).

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 2 (idle timer) and Task 4 (session store) — after Task 1 scaffold lands.
- Subagent type: coder (Sonnet)
- Rationale: `idle_timer.rs` and `session_store.rs` are independent Rust modules; both compile against `main.rs` only after the scaffold exists but have no inter-module dependency.

### Phase Validation Artifact
- File: `specs/phase-0-validation.md`
- Contents: The Phase Verification Checklist above as pass/fail conditions.

---

## Phase 1: Canvas Decay Overlay — First Shippable Checkpoint (Week 1 second half → Week 2)

### Agent Routing
- Recommended: Claude Code
- Rationale: Canvas 2D rendering, DOM geometry queries, and animation loop — requires interactive visual feedback to tune; this is the visible product.

### Objectives
- `DecayCanvas.tsx`: absolute-positioned Canvas overlay, `pointer-events: none`, sized to match the editor.
- `src/canvas/decay.ts`: `DecayRenderer` class — reads `DecayUpdate.level` + DOM bounding boxes → renders baseline drift, edge bleed (blur), and opacity fade.
- `useDecayEvents.ts` interpolation: smooths the 10 Hz level events across animation frames.
- **First shippable checkpoint**: a paragraph visibly decaying on idle, recovering on keystroke.

### Tasks
1. Implement `DecayCanvas.tsx` — Canvas element absolutely positioned over the editor; resizes with the window via `ResizeObserver`.
   - Context: The rendering surface; must track the editor bounding box exactly or distortion appears in the wrong place.
   - Acceptance: Canvas covers the editor precisely (no offset) at 100%, 125%, and 150% zoom; `pointer-events: none` verified by clicking through to the editor.
2. Implement `src/canvas/decay.ts` `DecayRenderer.render(level, words)` — takes the decay level and an array of `{text, rect}` word descriptors, applies Canvas distortion: `globalAlpha` fade, `filter: blur(${level * 4}px)`, baseline translate.
   - Context: All rendering logic lives here — never in React components.
   - Acceptance: At `level = 0.0` canvas is blank (transparent); at `level = 1.0` all words are blurred, offset ≥ 4 px on y-axis, and opacity ≤ 0.2.
3. Implement `useDecayEvents.ts` interpolation — buffers last two `DecayUpdate` events; uses `requestAnimationFrame` to interpolate `level` between them so decay feels continuous, not steppy.
   - Context: Makes the Rust 10 Hz tick feel smooth at 60 fps.
   - Acceptance: Level changes between two events are not visible as discrete jumps; the transition is visually smooth.
4. Wire `DecayCanvas` into `App.tsx` — on each animation frame, query word bounding boxes from the editor DOM and pass them with the interpolated level to `DecayRenderer.render`.
   - Context: The integration point that connects IPC events → Canvas distortion.
   - Acceptance: Idle for 5 s with `normal` intensity → visible distortion; type a key → distortion clears within one frame.

### Phase Verification Checklist
- [ ] Canvas covers editor with no pixel offset at 100% and 150% zoom
- [ ] `pointer-events: none` — clicks and keystrokes reach the editor through the canvas
- [ ] Idle 5 s (`normal` intensity) → visible blur + opacity change on editor text
- [ ] Resume typing → canvas clears to fully transparent within 1 frame (~16 ms)
- [ ] `pnpm vitest run` → all tests pass (word count, decay math)
- [ ] Window resize → canvas re-covers editor immediately (no flash of wrong size)

### Risks & Mitigations
- Risk: DOM bounding box queries on every animation frame are slow on large documents.
  - Mitigation: Limit DOM queries to visible viewport using `IntersectionObserver`; cache bounding boxes between frames and invalidate on `MutationObserver` change.
  - Fallback: Apply decay as a single full-canvas operation (opacity + blur on the whole canvas image) if per-word queries exceed 4 ms budget.
- Risk: Canvas pixel alignment drifts from editor text on high-DPI displays.
  - Mitigation: Set `canvas.width = rect.width * devicePixelRatio` and scale the context by `devicePixelRatio` at init.
  - Fallback: Accept 1-pixel drift on non-integer DPR values; imperceptible at decay blur levels.

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 2 (DecayRenderer) and Task 3 (interpolation hook) — both consume `DecayUpdate` types from Phase 0 but have no mutual dependency.
- Subagent type: coder (Sonnet)
- Rationale: `decay.ts` is a pure rendering module; `useDecayEvents.ts` is a pure event hook; they share only the `DecayUpdate` type from `src/types/ipc.ts`.

### Phase Validation Artifact
- File: `specs/phase-1-validation.md`
- Contents: Phase 1 verification checklist as pass/fail conditions.

---

## Phase 2: Decay Tuning, Intensity Setting, Word Drift, Robustness (Week 3)

### Agent Routing
- Recommended: Claude Code
- Rationale: Feel tuning (curves, timing, visual effects) requires iterative visual feedback; settings persistence is Rust + React integration.

### Objectives
- Word drift effect: slow lateral translation of individual words accumulating with decay level.
- Glyph edge bleed: subtle chromatic aberration fringe at high decay levels.
- `SettingsPanel.tsx`: intensity selector (gentle / normal / brutal) wired to `set_intensity` Tauri command.
- Decay curve tuning: non-linear ramp (ease-in) so the first seconds of idle feel safe and decay accelerates toward critical.
- Robustness: canvas/editor sync on paste, undo, and window resize.

### Tasks
1. Add word drift to `DecayRenderer.render` — each word gets a pseudorandom drift vector (seeded by word index) that scales with `level`; max drift at `level = 1.0` is ±12 px lateral, ±4 px vertical.
   - Context: The signature Pressfield effect — text that literally slides apart.
   - Acceptance: At `level = 0.8`, words have visually diverged from their anchors; drift direction is consistent (not random each frame) and scales smoothly with level.
2. Add chromatic aberration / glyph edge bleed — at `level > 0.5`, render the word bounding region twice with a 2 px RGB channel offset and `screen` blend mode.
   - Context: Visual metaphor of typographic degradation; the "bleed" effect.
   - Acceptance: At `level = 0.7`, a faint colour fringe is visible at word edges; at `level = 1.0`, the fringe is prominent.
3. Implement non-linear decay curve in `src/utils/decayMath.ts` — `levelFromMs(ms, intensity)` uses an ease-in cubic: `level = Math.pow(ms / full_decay_ms, 2)` clamped to [0, 1].
   - Context: Makes the first seconds feel safe (low decay rate) while the final seconds accelerate dramatically.
   - Acceptance: `vitest` — `levelFromMs(0, 'normal')` = 0.0; `levelFromMs(2500, 'normal')` ≈ 0.25; `levelFromMs(5000, 'normal')` = 1.0; curve is strictly increasing.
4. Implement `SettingsPanel.tsx` — intensity radio group (`gentle / normal / brutal`) invokes `set_intensity` IPC command; Rust updates `DecayState.intensity` and persists in the current session row.
   - Context: The one user control over the adversarial system — the difficulty dial.
   - Acceptance: Switching from `brutal` to `gentle` mid-session causes `full_decay_ms` to triple; next `DecayUpdate` reflects the new intensity; SQLite session row shows updated intensity.
5. Robustness: handle paste, undo, and resize — `MutationObserver` on the editor to invalidate word bounding box cache; `ResizeObserver` on the window to resize the canvas.
   - Context: The Phase 1 canvas sync breaks on paste (new DOM nodes) and resize; this task closes those gaps.
   - Acceptance: Paste a 500-word block → canvas re-syncs within 1 frame; window resize → canvas re-covers editor with no offset; Cmd+Z undo → canvas re-syncs.

### Phase Verification Checklist
- [ ] Word drift visible at `level = 0.8` (normal intensity, ~4 s idle) — words have diverged
- [ ] Chromatic fringe visible at `level = 0.7` on a light-background theme
- [ ] `levelFromMs(2500, 'normal')` ≈ 0.25 (vitest)
- [ ] Intensity selector changes onset time: `brutal` → full decay at ~2 s; `gentle` → ~8 s
- [ ] Paste 500 words → canvas re-syncs immediately, no offset artifacts
- [ ] Window resize → canvas re-covers editor, no gap or overflow
- [ ] `pnpm vitest run` → all tests pass
- [ ] `cargo test` → all pass

### Risks & Mitigations
- Risk: Word drift direction inconsistency (different each frame) makes text feel chaotic rather than drifting.
  - Mitigation: Seed drift vector from `(wordIndex * 2654435761) & 0xFFFF` (Knuth multiplicative hash) — deterministic per word, not per frame.
  - Fallback: Use a single global drift direction per session (all words drift the same way) if per-word seeding proves computationally expensive.
- Risk: Chromatic aberration bleed is visually harsh on dark themes.
  - Mitigation: Reduce RGB offset to 1 px and cap fringe opacity at 0.4 for the default dark theme; expose a theme-aware cap.
  - Fallback: Disable the bleed effect on dark themes and apply only blur + opacity — still effective, less jarring.

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 1 (word drift), Task 3 (decay curve math) — no shared implementation.
- Subagent type: coder (Sonnet) for Task 1; coder (Sonnet) for Task 3 (it has tests to write).
- Rationale: Drift rendering and math utilities are disjoint modules; both depend on types already defined in Phase 0.

### Phase Validation Artifact
- File: `specs/phase-2-validation.md`
- Contents: Phase 2 verification checklist as pass/fail conditions.

---

## Phase 3: Stats, Export, Themes, Hardcore Scaffold (Week 4)

### Agent Routing
- Recommended: Claude Code
- Rationale: Stats panel, export path, and theme system are UI-complete features; Rust side is minor (export command).

### Objectives
- `StatsPanel.tsx`: live stats sidebar — words this session, decay events survived, session duration.
- Export: `export_text` Tauri command returns the `contenteditable` inner text as plain UTF-8; a "Copy clean text" button in the UI.
- Themes: dark (default) + light; CSS custom property tokens; theme selector in settings.
- Hardcore mode scaffold: inert settings toggle labelled "Hardcore (coming in v2)" — wired to nothing.
- Session history: the last 10 sessions displayed in the stats sidebar (label, words, decay events survived, duration).

### Tasks
1. Implement `StatsPanel.tsx` + `useSessionStats.ts` hook — polls `get_stats` every 5 s; displays current session words, decay events, elapsed time.
   - Context: The feedback loop that rewards the writer for surviving decay.
   - Acceptance: After 3 decay events recovered, `decay_events` count in the panel reads 3; `word_count` increments within 5 s of writing.
2. Implement `export_text` Tauri command + "Copy clean text" UI button — the frontend sends `innerText` of the editor to Rust which writes it to the clipboard via Tauri's clipboard API.
   - Context: The escape hatch: no matter how decayed it looks, you can always get your text out clean.
   - Acceptance: After decay distortion is visible, clicking "Copy clean text" copies the full, undistorted prose; pasting into Notes shows clean text.
3. Implement theme system — CSS custom property tokens (`--bg`, `--fg`, `--canvas-tint`); dark default, light alternate; theme selector persists in `localStorage`.
   - Context: Dark is the adversarial default (midnight writing); light is for daytime.
   - Acceptance: Switching theme applies instantly with no flicker; decay effects are visible on both themes; theme persists across app restart.
4. Add hardcore mode scaffold — inert toggle in `SettingsPanel.tsx` labelled "Hardcore (coming in v2)"; renders disabled with a tooltip "In v2, decayed text will be permanently committed as lost. Off for now."
   - Context: Surface the v2 direction without building it; the toggle must be disconnected from all code paths.
   - Acceptance: The toggle renders in settings; clicking it does nothing; no code path connects to text mutation; the `vitest` for `Editor.tsx` asserts `contenteditable.innerText` is unchanged after any decay event.
5. Implement session history in stats panel — queries `get_recent_sessions` command (last 10); displays as a compact table (date, words, decay events, duration).
   - Context: Longitudinal motivation: see your streak of sessions where you survived the decay.
   - Acceptance: After 2 test sessions, the history table shows both with correct word counts and decay event counts.

### Phase Verification Checklist
- [ ] Stats panel shows live `word_count`, `decay_events`, elapsed time
- [ ] "Copy clean text" copies the full undistorted prose to clipboard
- [ ] Dark and light themes apply correctly; decay visible on both
- [ ] Hardcore toggle renders as disabled with v2 tooltip; does nothing when clicked
- [ ] `vitest`: `Editor.tsx` contenteditable `innerText` unchanged after decay event
- [ ] Session history table shows last 10 sessions with correct data
- [ ] `pnpm vitest run` → all tests pass
- [ ] `cargo test` → all pass
- [ ] `cargo tauri build` → produces a `.dmg` or `.app` bundle

### Risks & Mitigations
- Risk: `get_stats` polling at 5 s delay makes word count feel laggy.
  - Mitigation: Maintain a local `wordCount` state in React (increment on `input` event) for real-time display; `useSessionStats` is only for durable facts (decay events from SQLite).
  - Fallback: Emit a `stats-update` Tauri event from Rust on each `record_keystroke` call so stats are always push-based, not polled.
- Risk: Clipboard write via Tauri API requires an entitlement on macOS.
  - Mitigation: Enable `clipboard-read-write` in `tauri.conf.json` capabilities. Tauri 2 handles the entitlement.
  - Fallback: Write the text to a temp file and open it in the default text editor via `tauri-plugin-shell`.

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 1 (stats panel), Task 3 (theme system), Task 4 (hardcore scaffold) — disjoint UI surfaces.
- Subagent type: coder (Sonnet) for all three.
- Rationale: Stats panel, theme tokens, and the inert toggle share no state and touch different files; can be merged cleanly.

### Phase Validation Artifact
- File: `specs/phase-3-validation.md`
- Contents: Phase 3 verification checklist as pass/fail conditions.

---

## Section 5: SECURITY AND CREDENTIALS

- **Credential storage:** None in scope. Pressfield authenticates nothing and stores no secrets. There are no API keys, tokens, or passwords anywhere in the system.
- **Data boundaries:** Nothing leaves the machine. The hard constraint in 2c forbids all outbound network calls. Session data persists only to `~/.pressfield/pressfield.db`. The only network surface is Vite's HMR server, which is development-only and loopback-bound; it is absent from production builds.
- **Encryption at rest:** Historical v1 posture: the SQLite database contained only word counts, keystroke timestamps, and decay event records — no document content. Current v2 Arc 1 posture: clean prose is intentionally persisted locally in SQLite document bodies so writing survives app restarts. The app remains zero-network; local disk protection depends on the operator's FileVault/device security.
- **Content persistence:** Historical v1 posture: prose lived only in the `contenteditable` DOM and was never written by Pressfield. Current v2 Arc 1 posture: autosave writes clean prose to `documents.body`; decay remains visual-only and does not save corrupted/decayed text.
- **Token rotation:** Not applicable — no tokens anywhere in the system.
- **IPC trust boundary:** The Tauri IPC bridge is local; there is no authentication on Tauri commands. This is acceptable because the only IPC callers are the app's own webview. Tauri 2's capability system restricts which commands are exposed to the webview; `tauri.conf.json` must enumerate only the commands defined in `commands.rs`.
- **Hardcore mode deferred:** The v2 feature (permanent text mutation) will require an explicit user consent flow, a confirmation dialog, and clear warnings before it may be wired to any code path. No mechanism for this exists in v1.

---

## Section 6: TESTING STRATEGY

**Phase 0**
- Manual: `cargo tauri dev` launches window; `decay-update` events log to console at ~10 Hz; keystrokes reset `ms_idle`.
- Automate: `cargo test -- session_store` — round-trip creates session, logs keystrokes, ends session, returns stats; `pnpm vitest run` exits 0 on empty suite.
- Verify correctness: SQLite session row has correct `intensity`, `word_count = 0`, `decay_events = 0` after `end_session`; three keystroke rows in `keystrokes` table.

**Phase 1**
- Manual: Open app, wait 5 s idle (normal intensity) → visible blur/fade on editor text; type a key → canvas clears.
- Automate: `pnpm vitest run src/__tests__/wordCount.test.ts src/__tests__/decayMath.test.ts` — word count edge cases (emoji, trailing whitespace), decay level at t=0/2.5s/5s.
- Verify correctness: Canvas pixel-level test (JSDOM-limited; use visual inspection) — at `level = 0.0` canvas context `globalAlpha = 1.0`; at `level = 1.0` globalAlpha ≤ 0.2 and filter includes `blur`.

**Phase 2**
- Manual: Switch intensity mid-session; verify onset time changes visually; paste 500 words and confirm canvas re-syncs.
- Automate: `vitest` — `levelFromMs` cubic curve assertions; word drift vector consistency (same index → same direction across frames); chromatic fringe only appears at `level > 0.5`.
- Verify correctness: `set_intensity('brutal')` → next `DecayUpdate` has `intensity = 'brutal'`; SQLite session row updated; `set_intensity('gentle')` → `full_decay_ms` increases to 8000 in Rust state.

**Phase 3**
- Manual: Run two sessions; verify history table shows both; click "Copy clean text" with decay visible → paste into Notes → clean prose.
- Automate: `vitest` — `Editor.tsx` renders with decay active → assert `contenteditable.innerText` unchanged (hardcore guard); stats panel renders with mock `SessionStats`; hardcore toggle renders disabled.
- Verify correctness: `cargo tauri build` produces a `.dmg` or `.app` bundle; install and launch → DB created, session starts, stats panel visible.
