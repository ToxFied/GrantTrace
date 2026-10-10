import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Mark } from "./Mark";
import {
  Drift,
  FACT_TICKS,
  HOOK_POPS,
  Hook,
  INSPECT_HIGHLIGHT,
  INSPECT_STAMP_TYPING,
  INSPECT_TYPING,
  Inspect,
  Logo,
  OUTRO_TYPING,
  Outro,
  PIPELINE_POPS,
  Pipeline,
  Question,
  RECORD_COUNT_TICKS,
  RECORD_TYPING,
  REVIEW_PUNCH,
  REVIEW_TYPING,
  Record,
  Review,
} from "./scenes";
import { muted, paper, sans } from "./theme";
import { SCENES } from "./timeline";

const CUTS = [
  [Hook, SCENES.hook],
  [Question, SCENES.question],
  [Logo, SCENES.logo],
  [Record, SCENES.record],
  [Pipeline, SCENES.pipeline],
  [Drift, SCENES.drift],
  [Review, SCENES.review],
  [Inspect, SCENES.inspect],
  [Outro, SCENES.outro],
] as const;

type Cue = { sound: string; at: number; volume: number; frames?: number };
const typing = (scene: readonly [number, number], t: { at: number; frames: number }, volume = 0.3): Cue => ({
  sound: "typing",
  at: scene[0] + t.at,
  frames: t.frames,
  volume,
});

const CUES: Cue[] = [
  ...HOOK_POPS.map((at) => ({ sound: "pop", at, volume: 0.32 })),
  { sound: "whoosh", at: SCENES.hook[1] - 10, volume: 0.3 },
  { sound: "whoosh", at: SCENES.logo[1] - 8, volume: 0.35 },
  typing(SCENES.record, RECORD_TYPING),
  ...RECORD_COUNT_TICKS.map((at) => ({ sound: "tick", at: SCENES.record[0] + at, volume: 0.22 })),
  { sound: "whoosh", at: SCENES.record[1] - 8, volume: 0.35 },
  ...PIPELINE_POPS.map((at) => ({ sound: "pop", at: SCENES.pipeline[0] + at, volume: 0.28 })),
  typing(SCENES.review, REVIEW_TYPING),
  { sound: "tick", at: SCENES.review[0] + REVIEW_PUNCH, volume: 0.4 },
  { sound: "pop", at: SCENES.review[0] + REVIEW_PUNCH + 8, volume: 0.25 },
  { sound: "whoosh", at: SCENES.review[1] - 8, volume: 0.35 },
  { sound: "thump", at: SCENES.inspect[0], volume: 0.6 },
  typing(SCENES.inspect, INSPECT_STAMP_TYPING),
  { sound: "whoosh", at: SCENES.inspect[0] + 30, volume: 0.3 },
  typing(SCENES.inspect, INSPECT_TYPING, 0.2),
  { sound: "tick", at: SCENES.inspect[0] + INSPECT_HIGHLIGHT, volume: 0.4 },
  ...FACT_TICKS.map((at) => ({ sound: "tick", at: SCENES.inspect[0] + at, volume: 0.25 })),
  { sound: "whoosh", at: SCENES.inspect[1] - 10, volume: 0.3 },
  typing(SCENES.outro, OUTRO_TYPING),
];

/** Small persistent wordmark while the product is on screen. */
const Brand = () => {
  const frame = useCurrentFrame();
  const [from] = SCENES.record;
  const [driftFrom, driftTo] = SCENES.drift;
  const [, to] = SCENES.inspect;
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  const opacity =
    interpolate(frame, [from + 6, from + 20, to - 12, to], [0, 1, 1, 0], clamp) *
    (frame >= driftFrom && frame < driftTo ? 0 : 1);
  return (
    <div
      style={{
        position: "absolute",
        left: 110,
        bottom: 56,
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity,
        fontFamily: sans,
        fontSize: 20,
        fontWeight: 600,
        color: muted,
      }}
    >
      <Mark size={28} start={-100} />
      GrantTrace
    </div>
  );
};

export const GrantTraceVideo = () => (
  <AbsoluteFill style={{ background: paper }}>
    {CUTS.map(([Scene, [from, to]], i) => (
      <Sequence key={i} from={from} durationInFrames={to - from}>
        <Scene />
      </Sequence>
    ))}
    <Brand />
    <Audio src={staticFile("music.wav")} volume={0.42} />
    {CUES.map(({ sound, at, volume, frames }, i) => (
      <Sequence key={`sfx-${i}`} from={at} durationInFrames={frames ?? 30}>
        <Audio src={staticFile(`sfx/${sound}.wav`)} volume={volume} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
