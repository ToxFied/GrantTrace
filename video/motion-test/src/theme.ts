import { Easing, interpolate } from "remotion";

export const ink = "#080808";
export const paper = "#ffffff";
export const muted = "#666666";
export const faint = "#9a9a9a";
export const hairline = "#dedede";
export const chip = "#f2f2f2";

export const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const ease = Easing.bezier(0.22, 1, 0.36, 1);

export const progress = (frame: number, start: number, length = 16) =>
  interpolate(frame, [start, start + length], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

export const enter = (frame: number, start: number, distance = 24, length = 18) => {
  const p = progress(frame, start, length);
  return { opacity: p, transform: `translateY(${(1 - p) * distance}px)` };
};
