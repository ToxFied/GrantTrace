import type { ReactNode } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { enter, ink, muted, mono } from "./theme";

export const Eyebrow = ({ children, at, inverted }: { children: ReactNode; at: number; inverted?: boolean }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        ...enter(frame, at, 12),
        display: "inline-flex",
        alignSelf: "flex-start",
        fontFamily: mono,
        fontSize: 17,
        fontWeight: 600,
        letterSpacing: 1.8,
        textTransform: "uppercase",
        color: inverted ? "#fff" : muted,
        background: inverted ? ink : "#f2f2f2",
        border: `1px solid ${inverted ? ink : "#d8d8d8"}`,
        borderRadius: 9,
        padding: "8px 14px",
      }}
    >
      {children}
    </div>
  );
};

export const Sub = ({ children, at }: { children: ReactNode; at: number }) => {
  const frame = useCurrentFrame();
  return <div style={{ ...enter(frame, at, 16), fontSize: 27, lineHeight: 1.45, color: muted, textWrap: "pretty" }}>{children}</div>;
};

export const TITLE = { fontSize: 62, fontWeight: 700, letterSpacing: -1.9, lineHeight: 1.08 } as const;

/** Text column on the left, terminal on the right. */
export const Split = ({ left, right }: { left: ReactNode; right: ReactNode }) => (
  <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 110px", gap: 80 }}>
    <div style={{ width: 520, display: "flex", flexDirection: "column", gap: 28 }}>{left}</div>
    <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>{right}</div>
  </AbsoluteFill>
);
