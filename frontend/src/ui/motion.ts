/**
 * Durations (in seconds) for animation driven from JS with motion/react. They mirror
 * --duration-fast and --duration-base in src/app/globals.css; change both together.
 */
export const DURATION = {
  /** press feedback, exits, small toggles */
  fast: 0.15,
  /** entrances, moves, layout changes */
  base: 0.2,
} as const;

/** Entrances and moves ease out: quick to respond, gentle to settle. */
export const EASE = 'easeOut' as const;

export const enter = { duration: DURATION.base, ease: EASE };
export const exit = { duration: DURATION.fast, ease: EASE };
