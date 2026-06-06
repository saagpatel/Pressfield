# Arc 2 — Hardcore Mode (design spec)

_Brainstormed 2026-06-06. Branch `feat/v2-persistence` (Arc 2 may get its own branch at P7)._

Hardcore mode: prose is **permanently destroyed** when decay is held past full
decay. Opt-in, **global**, **OFF by default**. This reverses the v1/Arc-1 core
invariant (decay was a recoverable visual distortion only) and is therefore a
deliberate ethical/UX contract, not a background feature. This spec is the
contract the per-phase TDD rhythm executes against.

## The locked contract

| Dimension | Decision |
|---|---|
| Shape | Discrete destruction **bites**, not continuous erosion |
| Trigger | **Full decay** (`level ≥ 1.0`). The existing 2–8s `t²` ramp is the untouched fuse — nothing is destroyed during the ramp |
| Recoverability | **Hard line.** No grace window. Maximal visual corruption *is* the warning |
| What dies | **Trailing** tail-first — the last **10%** of current words per bite (min **1** word; the doc honestly erodes toward empty) |
| Bite size | **Constant** across intensities (10%). Intensity scales **only** the cadence |
| Cadence | Held at full decay, bites repeat every: **Brutal 1000ms · Normal 2000ms · Gentle 3000ms** |
| Pause | **Pause on window blur** (hardcore-only · window-focus not editor-focus · **resume, don't reset**) |
| Reset | Any keystroke resets idle and stops eating. **Already-dead text stays dead.** |
| Toggle | **Global**, OFF by default, **one-time confirm** on first enable |

## Architecture: Rust owns _when_, TS owns _what_

**Why Rust owns the cadence clock:** destruction must be wall-clock reliable.
A TS `setInterval`/RAF clock throttles when the window is backgrounded — but the
idle timer already lives in Rust as an OS-thread clock that ticks regardless, and
the window-focus signal (`WindowEvent::Focused`) is natively Rust-side. One
coherent Rust component owns: count idle → pause on blur → run the bite cadence
past full decay. TS owns only the consequence (DOM mutation + flush), because it
owns the `contenteditable`.

### Event flow per bite

1. **Rust tick thread** (100ms): when `hardcore && focused && level ≥ 1.0`,
   accumulate time-at-full-decay; each time it crosses the intensity cadence,
   emit a typed **`decay-bite`** event (`DecayBite { seq: u64 }`).
2. **TS `decay-bite` listener** (not RAF-gated; fires even when another window of
   the same app holds focus): remove the trailing 10% of words from the editor,
   then **flush to SQLite synchronously** via the existing `save_document`
   command — **never** the 750ms autosave debounce.
3. The existing `MutationObserver → WordBoxCache.invalidate()` re-measures the
   canvas for the shortened doc for free. The visual just follows.

### The save/decay knot — resolved

- Autosave persists clean `innerText` on a 750ms debounce (Arc 1). A bite mutates
  the text, so the shrunken body **is the only version** — there is no original
  behind it. That is hardcore.
- **A bite must flush synchronously.** If a bite mutated the text but the app died
  before the debounce fired, the pre-bite body would still be on disk and the
  words would **resurrect on relaunch** — silently breaking the contract.
  Bite = `removeTrailingWords` + `save_document` **now**.

## Backend changes (Rust)

- **`schema.sql` + `session_store.rs`:** new `settings(key TEXT PRIMARY KEY, value
  TEXT NOT NULL)` table; **v2→v3 `PRAGMA user_version` migration** mirroring the
  v1→v2 one (idempotent). Helpers `get_setting` / `set_setting`. The global
  hardcore flag persists here under key `"hardcore"`.
- **`idle_timer.rs`:** add `hardcore: AtomicBool` and `focused: AtomicBool` to
  `IdleTimer` (mirrors the `intensity: AtomicU8` lock-free pattern). The tick
  thread:
  - If `hardcore && !focused`: **pause** — snapshot without advancing `ms_idle`
    (resume-not-reset). When hardcore is OFF, blur changes nothing (v1 feel
    preserved).
  - If `hardcore && focused && level ≥ 1.0`: accumulate a thread-local
    `ms_since_bite`; when `≥ cadence(intensity)`, emit `decay-bite` and subtract
    the cadence. `level < 1.0` (incl. after a keystroke reset) zeroes
    `ms_since_bite`.
  - Cadence: `Brutal 1000 · Normal 2000 · Gentle 3000` ms (new
    `Intensity::bite_cadence_ms`).
- **`decay.rs`:** new `DecayBite { seq: u64 }` payload; `DECAY_BITE_EVENT =
  "decay-bite"`.
- **`commands.rs`:** new `set_hardcore(enabled: bool)` — persist to `settings`
  first, then `timer.set_hardcore(enabled)` (mirrors `set_intensity`'s
  persist-then-retune ordering). Global — no `session_id`.
- **`lib.rs`:** read the persisted `"hardcore"` setting at setup to init the
  timer; wire `on_window_event` → `WindowEvent::Focused(b)` → `timer.set_focused(b)`;
  register `set_hardcore` in the invoke handler.

## Frontend changes (TS/React)

- **`src/utils/destruction.ts` (pure, tested):** `removeTrailingWords(text:
  string, fraction: number): string` — tokenize on `/\S+/g` (consistent with
  `wordBoxes.ts`), drop the last `max(1, ceil(N·fraction))` tokens and their
  trailing whitespace. No-op on empty/whitespace-only input. **No decay logic in
  React components** (CLAUDE.md): the component/hook orchestrates; the math lives
  here.
- **`decay-bite` listener** (in the decay-events hook): on event → read editor
  text → `removeTrailingWords(text, 0.10)` → write back → `invoke("save_document",
  …)` synchronously → **defeat native undo** (see sharp edges).
- **`SettingsPanel.tsx`:** make the inert toggle live — `checked` reflects the
  global flag, `onChange` fires a **one-time confirm modal** on first enable, then
  `invoke("set_hardcore", { enabled })`. Reuse the `set_intensity` error-logging
  pattern.
- **`src/types/ipc.ts`:** add `DecayBite` + an `isDecayBite` runtime guard
  (mirrors `isDecayUpdate`).

## Sharp edges (solve explicitly, don't hand-wave)

1. **Native `contenteditable` undo.** A bite removed via ordinary DOM mutation may
   be `Cmd+Z`-recoverable → breaks "permanent." After a bite, normalize the
   editor so the removal is **not a single undoable op** (e.g. reset the field
   content / clear the undo history). The DB flush is the source of truth; the
   editor must not be able to out-vote it. **Verified by test in P8.**
2. **Empty / whitespace-only doc.** Bite is a no-op (nothing to remove). Guard in
   `removeTrailingWords`.
3. **Caret / selection at bite time.** Removing the tail must not throw if the
   selection spanned the removed region; restore a sane caret.
4. **Sleep / wake.** On wake `ms_idle` jumps; `projectLevel`'s `MAX_PROJECT_MS`
   hold + `decay_level` clamp already bound the visual. You wake at full decay and
   bites resume — acceptable (you genuinely walked away).
5. **Window focus ≠ editor focus.** Pause only on whole-window blur. Opening
   Settings or the Cmd+O palette is staying in the app — must **not** pause.

## textIntegrity contract split

`src/__tests__/textIntegrity.test.ts` is the v1 "text survives decay" contract.
Split it:

- **Hardcore OFF** → text survives any decay level (existing guarantee holds).
- **Hardcore ON** → past full decay, the trailing tail is destroyed and does not
  return (new, tested guarantee). Assert head survives, tail is gone, and a
  post-bite undo cannot restore it.

## Phase split (Arc 1 rhythm: plan → solo TDD → /code-review → mission commit)

- **P7 — Backend: the kill switch + clock.** settings table + v2→v3 migration;
  `set_hardcore` + persistence; `IdleTimer` hardcore/focused atomics; tick-thread
  cadence + pause-on-blur; `DecayBite` event; `on_window_event` wiring. Rust unit
  tests: cadence crossing math, pause-on-blur, full-decay gating, migration
  idempotency. **No text destroyed yet — the event just fires.**
- **P8 — Frontend: the consequence.** `removeTrailingWords` (pure + tested);
  `decay-bite` listener → mutate → synchronous flush → **defeat undo**; live
  toggle + one-time confirm; `DecayBite` type + guard; **split
  textIntegrity.test.ts**.
- **P9 — Polish + verify.** Edge cases (empty doc, selection, IME), optional
  words-destroyed stat, operator visual pass, `/ultrareview`, mission commit.

## Deferred / optional

- **Words-destroyed stat.** A `destruction_events` row or a per-session counter
  ("words lost to decay") would be a satisfying stat, but it's not load-bearing
  for the contract. Candidate for P9 or a later polish pass.

## Constraint lifted (consciously)

CLAUDE.md's "Do NOT implement hardcore mode" is now a **satisfied gate**: the
contract is explicit (this file), operator-approved, opt-in, and OFF by default.
The Key Decisions row + Do-NOT get restamped to point here (operator-gated edit).
