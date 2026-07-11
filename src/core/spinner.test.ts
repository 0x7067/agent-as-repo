import { describe, it, expect } from "vitest";
import { renderSpinnerFrame, renderStaticSpinnerLine, SPINNER_FRAMES } from "./spinner.js";

describe("renderSpinnerFrame", () => {
  it("renders the frame at the given index with a leading carriage return", () => {
    expect(renderSpinnerFrame("Asking my-app...", 0)).toBe(`\r${SPINNER_FRAMES[0]} Asking my-app...`);
  });

  it("advances through frames in order", () => {
    expect(renderSpinnerFrame("Working", 1)).toBe(`\r${SPINNER_FRAMES[1]} Working`);
    expect(renderSpinnerFrame("Working", 2)).toBe(`\r${SPINNER_FRAMES[2]} Working`);
  });

  it("wraps around when the frame index exceeds the frame count", () => {
    expect(renderSpinnerFrame("Working", SPINNER_FRAMES.length)).toBe(`\r${SPINNER_FRAMES[0]} Working`);
  });
});

describe("renderStaticSpinnerLine", () => {
  it("renders a single line with a trailing newline and no animation characters", () => {
    const line = renderStaticSpinnerLine("Asking my-app...");
    expect(line).toBe("Asking my-app...\n");
    expect(line).not.toContain("\r");
    for (const frame of SPINNER_FRAMES) {
      expect(line).not.toContain(frame);
    }
  });
});
