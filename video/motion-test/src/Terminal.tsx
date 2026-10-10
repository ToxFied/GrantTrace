import { interpolate, interpolateColors, useCurrentFrame } from "remotion";
import { ink, mono, progress } from "./theme";

export type LineKind = "cmd" | "cont" | "head" | "label" | "body" | "strong" | "dim" | "blank";
/** Kind, text, and an optional number that `{n}` in the text counts up to. */
export type Line = [LineKind, string?, number?];

const COLOR: Record<LineKind, string> = {
  cmd: "#f5f5f5",
  cont: "#f5f5f5",
  head: "#ffffff",
  label: "#8f8f8f",
  body: "#c8c8c8",
  strong: "#ffffff",
  dim: "#767676",
  blank: "#000",
};

const LINE_GAP = 3;
const AFTER_COMMAND = 10;
const isCommand = (kind: LineKind) => kind === "cmd" || kind === "cont";

/** Frame offsets (relative to `start`) at which each line appears. */
export const schedule = (lines: Line[], typeSpeed = 1.6) => {
  const starts: number[] = [];
  let t = 0;
  let typing = true;
  let typed = 0;
  for (const [kind, text = ""] of lines) {
    if (typing && !isCommand(kind)) {
      typed = t;
      t += AFTER_COMMAND;
      typing = false;
    }
    starts.push(t);
    t += isCommand(kind) ? Math.ceil(text.length / typeSpeed) + 2 : LINE_GAP;
  }
  return { starts, typed: typing ? t : typed, end: t };
};

export const Terminal = ({
  lines,
  start,
  width,
  fontSize = 23,
  typeSpeed = 1.6,
  title = "granttrace · local fixture",
  highlight,
  enterAt = start - 12,
}: {
  lines: Line[];
  start: number;
  width: number;
  fontSize?: number;
  typeSpeed?: number;
  title?: string;
  highlight?: { line: number; at: number };
  enterAt?: number;
}) => {
  const frame = useCurrentFrame();
  const local = frame - start;
  const { starts } = schedule(lines, typeSpeed);
  const windowIn = progress(frame, enterAt, 14);
  const lastCommand = lines.findLastIndex(([kind]) => isCommand(kind));

  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: "hidden",
        background: "#0a0a0a",
        boxShadow: "0 40px 100px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.1)",
        opacity: windowIn,
        transform: `translateY(${(1 - windowIn) * 40}px) scale(${0.97 + windowIn * 0.03})`,
      }}
    >
      <div style={{ height: 54, background: "#141414", display: "flex", alignItems: "center", position: "relative", paddingLeft: 22, gap: 9 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 13, height: 13, borderRadius: 7, background: "#3a3a3a" }} />
        ))}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: mono,
            fontSize: 16,
            color: "#7c7c7c",
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ padding: "34px 44px 40px", fontFamily: mono, fontSize, lineHeight: 1.62 }}>
        {lines.map(([kind, raw = "", countTo], i) => {
          const t = local - starts[i];
          const command = isCommand(kind);
          const counted = Math.round(interpolate(t, [2, 14], [0, countTo ?? 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
          const text = raw.replace("{n}", String(counted));
          const shown = command ? text.slice(0, Math.max(0, Math.floor(t * typeSpeed))) : text;
          const typingNow = command && t >= 0 && shown.length < text.length;
          const idle = i === lastCommand && t >= 0 && !typingNow && local < starts[i + 1];
          const visible = command
            ? t >= 0
              ? 1
              : 0
            : interpolate(t, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const lit = highlight?.line === i ? progress(frame, highlight.at, 10) : 0;
          const indent = text.length - text.trimStart().length;

          return (
            <div
              key={i}
              style={{
                position: "relative",
                whiteSpace: "pre",
                minHeight: "1.62em",
                opacity: visible,
                transform: `translateY(${(1 - visible) * 8}px)`,
                color: interpolateColors(lit, [0, 1], [COLOR[kind], ink]),
                fontWeight: kind === "head" || kind === "strong" ? 600 : 400,
              }}
            >
              {lit > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: `calc(${indent}ch - 12px)`,
                    top: 2,
                    bottom: 2,
                    width: `calc(${text.trimStart().length}ch + 24px)`,
                    background: "#fff",
                    borderRadius: 6,
                    transform: `scaleX(${lit})`,
                    transformOrigin: "left",
                  }}
                />
              )}
              <span style={{ position: "relative" }}>
                {kind === "cmd" && <span style={{ color: "#6b6b6b" }}>$ </span>}
                {kind === "cont" && <span style={{ color: "#6b6b6b" }}>{"> "}</span>}
                {shown}
                {(typingNow || (idle && Math.floor(frame / 15) % 2 === 0)) && (
                  <span style={{ background: "#f5f5f5", color: "#f5f5f5" }}> </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
