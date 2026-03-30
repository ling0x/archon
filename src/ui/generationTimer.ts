/**
 * Live elapsed-time display while an answer is streaming.
 *
 * Uses one setInterval at 1 Hz — one text node update per tick. Always call
 * `stop()` when the turn finishes or the DOM is torn down to avoid leaks.
 */

export type GenerationTickerHandle = {
  stop: () => void;
};

/** Labels whole seconds as "0 s", "1 s", "2 s", … */
function formatWholeSeconds(seconds: number): string {
  return `${seconds} s`;
}

/**
 * Fires immediately, then every `intervalMs` (default 1000).
 * Elapsed seconds follow wall time (`floor(elapsed / 1000)`), independent of interval length.
 */
export function startGenerationTicker(
  onTick: (label: string, wholeSeconds: number) => void,
  options?: { intervalMs?: number },
): GenerationTickerHandle {
  const stepMs = options?.intervalMs ?? 1000;
  const t0 = performance.now();

  const tick = (): void => {
    const wholeSeconds = Math.floor((performance.now() - t0) / 1000);
    onTick(formatWholeSeconds(wholeSeconds), wholeSeconds);
  };

  tick();
  const id = window.setInterval(tick, stepMs);

  return {
    stop: () => window.clearInterval(id),
  };
}
