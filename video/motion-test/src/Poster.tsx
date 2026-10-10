import { AbsoluteFill, Sequence } from "remotion";
import { ink, mono, sans } from "./theme";
import { Review } from "./scenes";

/** README thumbnail: a frame from the review scene with a play button. */
export const Poster = () => (
  <AbsoluteFill>
    {/* Review scene just after the punch-in, with the permission highlighted. */}
    <Sequence from={-112} durationInFrames={120}>
      <Review />
    </Sequence>
    <AbsoluteFill style={{ border: "2px solid #dedede" }} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 52 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          background: ink,
          color: "#fff",
          fontFamily: sans,
          borderRadius: 999,
          padding: "18px 36px 18px 24px",
          fontSize: 30,
          fontWeight: 600,
          boxShadow: "0 24px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.12)",
        }}
      >
        <svg width="44" height="44" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="23" fill="#fff" />
          <path d="M18.5 14.5v17l14-8.5z" fill={ink} />
        </svg>
        Watch the overview
        <span style={{ fontFamily: mono, fontSize: 24, color: "#9a9a9a", fontWeight: 400 }}>0:38</span>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
