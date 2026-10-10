import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ease } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Piecewise keyframes, eased per segment: [[frame, value], ...]. */
export const keys = (frame: number, points: [number, number][], easing = ease) =>
  interpolate(frame, points.map(([f]) => f), points.map(([, v]) => v), { ...clamp, easing });

export const pop = (frame: number, at: number, fps: number, damping = 11) =>
  spring({ frame: frame - at, fps, config: { damping, stiffness: 170, mass: 0.7 } });

/** Whip transition: slides in from `dir` and out the opposite way with blur. */
export const whip = (frame: number, duration: number, opts: { in?: number; out?: number; axis?: "x" | "y" } = {}) => {
  const axis = opts.axis ?? "x";
  const inDir = opts.in ?? 0;
  const outDir = opts.out ?? 0;
  const enter = inDir ? interpolate(frame, [0, 7], [1, 0], { ...clamp, easing: Easing.out(Easing.exp) }) : 0;
  const exit = outDir ? interpolate(frame, [duration - 7, duration], [0, 1], { ...clamp, easing: Easing.in(Easing.exp) }) : 0;
  const offset = enter * inDir * 700 - exit * outDir * 700;
  const blur = (enter + exit) * 28;
  const stretch = 1 + (enter + exit) * 0.12;
  const move = axis === "x" ? `translateX(${offset}px) scaleX(${stretch})` : `translateY(${offset}px) scaleY(${stretch})`;
  return { transform: move, filter: blur > 0.3 ? `blur(${blur}px)` : undefined } satisfies CSSProperties;
};

/** Transform that frames point (x, y) of a 1920x1080 stage at the given zoom. */
export const focus = (x: number, y: number, zoom: number) =>
  `translate(${(960 - x) * zoom}px, ${(540 - y) * zoom}px) scale(${zoom})`;

/** Words rise into view from behind a mask, one after another. */
export const Words = ({
  text,
  at,
  stagger = 3,
  style,
  accent,
  accentStyle,
}: {
  text: string;
  at: number;
  stagger?: number;
  style?: CSSProperties;
  accent?: string[];
  accentStyle?: CSSProperties;
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: "0.26em", ...style }}>
      {text.split(" ").map((word, i) => {
        const p = interpolate(frame, [at + i * stagger, at + i * stagger + 14], [0, 1], {
          ...clamp,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", padding: "0.06em 0 0.14em", margin: "-0.06em 0 -0.14em" }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 4}deg)`,
                transformOrigin: "left bottom",
                ...(accent?.includes(word) ? accentStyle : undefined),
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/** Letters of a single word rise into view with a one-frame stagger. */
export const Letters = ({ text, at, style }: { text: string; at: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", overflow: "hidden", padding: "0.08em 0 0.16em", ...style }}>
      {[...text].map((ch, i) => {
        const p = interpolate(frame, [at + i, at + i + 16], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
        return (
          <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - p) * 115}%)`, opacity: Math.min(1, p * 3) }}>
            {ch}
          </span>
        );
      })}
    </div>
  );
};

export const Stage = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ position: "absolute", inset: 0, ...style }}>{children}</div>
);

export const useFps = () => useVideoConfig().fps;
