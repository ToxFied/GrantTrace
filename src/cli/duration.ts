const DURATION_PATTERN = /^([1-9][0-9]*)(ms|s|m)$/u;

export function parseBoundedDuration(
  input: string,
  bounds: { minimumMs: number; maximumMs: number },
): number | null {
  const match = DURATION_PATTERN.exec(input);
  if (match === null) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : 60_000;
  const duration = amount * multiplier;
  return Number.isSafeInteger(duration) &&
    duration >= bounds.minimumMs &&
    duration <= bounds.maximumMs
    ? duration
    : null;
}

export function formatDuration(milliseconds: number): string {
  return milliseconds % 60_000 === 0
    ? `${milliseconds / 60_000}m`
    : `${milliseconds / 1_000}s`;
}
