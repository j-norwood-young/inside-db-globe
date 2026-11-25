import { DATA } from '../data';

/**
 * Simulated clock. All animation (earth rotation, sun, story markers) is a pure
 * function of `t` so the camera never desyncs from the terminator.
 *
 *   t      — simulated time, epoch ms UTC
 *   playing— whether the rAF loop advances t
 *
 * There is one playback rate: the whole window in PLAY_MS of real time.
 */
export const clock = {
  t: DATA.windowStart,
  playing: true
};

export const PLAY_MS = 30000;
/** sim-ms advanced per real-ms (~7.4 sim-hours per second for the 9.2-day window) */
export const PLAY_SPEED = (DATA.windowEnd - DATA.windowStart) / PLAY_MS;

export const clampWindow = (t: number) =>
  Math.min(DATA.windowEnd, Math.max(DATA.windowStart, t));

/** Advance the sim clock by a real-time delta. */
export function tickClock(dtMs: number) {
  if (!clock.playing) return;
  clock.t = clampWindow(clock.t + dtMs * PLAY_SPEED);
  if (clock.t >= DATA.windowEnd) clock.playing = false;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC, e.g. "Thu 23 Nov 2026, 10:10" — the one date format used across the UI */
export function fmtSimTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(
    d.getUTCHours()
  )}:${p(d.getUTCMinutes())}`;
}
