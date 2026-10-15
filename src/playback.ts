export function isWithinPlayback(
  scrobbledAt: number | null,
  durationMs: number | null,
  now: number,
) {
  return (
    scrobbledAt !== null &&
    durationMs !== null &&
    now < scrobbledAt + durationMs
  );
}
