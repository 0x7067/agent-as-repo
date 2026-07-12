/** Braille spinner frames, in animation order. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * One TTY spinner frame: a leading carriage return (so repeated writes
 * overwrite the same terminal line) plus the frame glyph and label.
 */
export function renderSpinnerFrame(label: string, frameIndex: number): string {
  const normalizedIndex = ((frameIndex % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length;
  const frame = SPINNER_FRAMES[normalizedIndex];
  return `\r${frame} ${label}`;
}

/**
 * Single static line for non-TTY output (piped logs, CI): no animation, no
 * carriage returns — printed once instead of flooding the log with hundreds
 * of overwritten frames.
 */
export function renderStaticSpinnerLine(label: string): string {
  return `${label}\n`;
}
