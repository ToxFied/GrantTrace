import { interpolate, useCurrentFrame } from "remotion";
import { ease, ink, progress } from "./theme";

const TRACES = [
  "M18 21h6c10 0 10 17 20 17h14",
  "M18 38h40",
  "M18 55h6c10 0 10-17 20-17",
];

export const Mark = ({ size, start = 0 }: { size: number; start?: number }) => {
  const frame = useCurrentFrame();
  const box = progress(frame, start, 14);
  const scale = interpolate(box, [0, 1], [0.86, 1]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 76 76"
      style={{ opacity: box, transform: `scale(${scale})`, flexShrink: 0 }}
    >
      <rect width="76" height="76" rx="20" fill={ink} />
      {TRACES.map((d, i) => {
        const drawn = interpolate(frame, [start + 8 + i * 5, start + 30 + i * 5], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        });
        return (
          <path
            key={d}
            d={d}
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1 - drawn}
            opacity={drawn > 0 ? 1 : 0}
            fill="none"
            stroke="#fff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={7}
          />
        );
      })}
    </svg>
  );
};
