/** A paused habitat keeps its clock but stops simulating, so an absence costs nothing. */
export interface PauseState { updatedAtMs: number; pausedAtMs?: number }

const CLOCK_KEY = 'updatedAtMs';

/**
 * Stored timestamps are simulation times, so resuming moves every one of them forward by the
 * paused duration and the box continues from where it stopped.
 */
function shiftClocks(value: unknown, deltaMs: number): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) shiftClocks(item, deltaMs); return; }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'number' && key !== CLOCK_KEY && key.endsWith('Ms') && Number.isFinite(item)) (value as Record<string, number>)[key] = item + deltaMs;
    else if (item && typeof item === 'object') shiftClocks(item, deltaMs);
  }
}

export function pauseHabitat<T extends PauseState>(state: T, nowMs: number): T {
  state.pausedAtMs ??= nowMs;
  return state;
}

/** Returns the frozen duration in milliseconds; 0 means the habitat was already running. */
export function resumeHabitat<T extends PauseState>(state: T, nowMs: number): number {
  const pausedAtMs = state.pausedAtMs;
  if (pausedAtMs === undefined) return 0;
  const frozenMs = Math.max(0, nowMs - pausedAtMs);
  shiftClocks(state, frozenMs);
  state.updatedAtMs = nowMs;
  delete state.pausedAtMs;
  return frozenMs;
}

export function pausedAt(state: PauseState): number | undefined {
  return state.pausedAtMs;
}

/** Inspection shows whether the box is frozen and for how long, so a caretaker can tell it apart from a stalled box. */
export function pauseInfo(state: PauseState, nowMs: number): { paused: true; frozenHours: number } | { paused: false } {
  if (state.pausedAtMs === undefined) return { paused: false };
  return { paused: true, frozenHours: Math.round(Math.max(0, nowMs - state.pausedAtMs) / 36_000) / 100 };
}
