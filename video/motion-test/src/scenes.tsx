import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { Eyebrow, Split, Sub, TITLE } from "./Layout";
import { Mark } from "./Mark";
import { Letters, Stage, Words, focus, keys, pop, useFps, whip } from "./motion";
import { Terminal, schedule, type Line } from "./Terminal";
import { chip, hairline, ink, mono, muted, paper, sans } from "./theme";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

// Terminal geometry inside <Split>: 1100px wide, flush right, vertically centred.
const TERM_X = 754;
const CHAR = 13.8;
const LINE = 23 * 1.62;
const termTop = (lines: number) => (1080 - (lines * LINE + 128)) / 2;
const lineY = (lines: number, i: number) => termTop(lines) + 88 + i * LINE + LINE / 2;

// ------------------------------------------------------------------- hook

const CHIPS = ["contents: write", "issues: write", "pull_requests: write", "checks: write", "actions: read", "administration: write"];
export const HOOK_POPS = CHIPS.map((_, i) => 15 + Math.round(i * 7.5));

export const Hook = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const zoom = keys(frame, [[0, 1], [96, 1.05], [120, 1.25]], Easing.in(Easing.quad));
  const blur = interpolate(frame, [104, 120], [0, 16], clamp);
  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 60, transform: `scale(${zoom})`, filter: `blur(${blur}px)` }}>
        <Words
          text="Your GitHub App asks for all of this."
          at={0}
          style={{ fontSize: 84, fontWeight: 700, letterSpacing: -2.6, justifyContent: "center" }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 18, width: 1240 }}>
          {CHIPS.map((name, i) => {
            const p = pop(frame, HOOK_POPS[i], fps);
            const scary = i === CHIPS.length - 1;
            return (
              <div
                key={name}
                style={{
                  fontFamily: mono,
                  fontSize: 32,
                  padding: "14px 24px",
                  borderRadius: 14,
                  border: `1px solid ${scary ? ink : hairline}`,
                  background: scary ? ink : "#fff",
                  color: scary ? "#fff" : ink,
                  boxShadow: "0 14px 30px rgba(0,0,0,0.06)",
                  opacity: Math.min(1, p * 1.5),
                  transform: `translateY(${(1 - p) * 30}px) scale(${0.6 + 0.4 * p})`,
                }}
              >
                {name}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// --------------------------------------------------------------- question

export const Question = () => {
  const frame = useCurrentFrame();
  const zoom = keys(frame, [[0, 1.06], [100, 1]]);
  const iris = keys(frame, [[98, 0], [120, 36]], Easing.in(Easing.cubic));
  const big = { fontSize: 118, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02, justifyContent: "center" } as const;
  return (
    <AbsoluteFill style={{ background: "#050505", fontFamily: sans }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 10, transform: `scale(${zoom})` }}>
        <Words text="Which ones does it" at={2} stagger={4} style={{ ...big, color: "#6f6f6f" }} />
        <Words text="actually use?" at={20} stagger={6} style={{ ...big, color: "#fff" }} />
        <div style={{ height: 40 }} />
        <Words text="GitHub shows what it can access. Not why." at={62} stagger={3} style={{ fontSize: 36, color: "#8a8a8a", justifyContent: "center" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 76, height: 76, borderRadius: 20, background: paper, transform: `scale(${iris})` }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------- logo

export const Logo = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const slam = pop(frame, 0, fps, 13);
  const beta = pop(frame, 15, fps);
  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink, ...whip(frame, 60, { out: 1 }) }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40, transform: `scale(${keys(frame, [[0, 1], [60, 1.05]])})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ transform: `scale(${1.5 - 0.5 * slam})` }}>
            <Mark size={168} start={-6} />
          </div>
          <Letters text="GrantTrace" at={5} style={{ fontSize: 108, fontWeight: 700, letterSpacing: -3.3 }} />
          <div
            style={{
              fontFamily: mono,
              fontSize: 21,
              fontWeight: 600,
              letterSpacing: 2.2,
              color: "#5f5f5f",
              background: chip,
              border: "1px solid #d8d8d8",
              borderRadius: 12,
              padding: "10px 18px",
              opacity: Math.min(1, beta * 1.5),
              transform: `scale(${0.5 + 0.5 * beta})`,
            }}
          >
            BETA
          </div>
        </div>
        <Words
          text="See which GitHub permissions each tested behavior actually uses."
          at={20}
          stagger={2}
          style={{ fontSize: 34, color: muted, justifyContent: "center" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----------------------------------------------------------------- record

const RECORD: Line[] = [
  ["cmd", "pnpm exec granttrace record issue-triage -- \\"],
  ["cont", "pnpm test -- issue-triage"],
  ["blank"],
  ["head", "GrantTrace recording started"],
  ["body", "Scenario issue-triage"],
  ["body", "Timeout 15m"],
  ["head", "GrantTrace record complete"],
  ["blank"],
  ["body", "Observed {n} GitHub REST operations", 4],
  ["blank"],
  ["label", "Next"],
  ["body", "granttrace check"],
];
const RECORD_START = 10;
const recordPlan = schedule(RECORD);
const recordOutput = RECORD_START + recordPlan.starts[3];
export const RECORD_TYPING = { at: RECORD_START, frames: recordPlan.typed };
export const RECORD_COUNT_TICKS = [4, 7, 10, 13].map((d) => RECORD_START + recordPlan.starts[8] + d);

const cursor = (frame: number) => {
  const t = frame - RECORD_START;
  const line = t < recordPlan.starts[1] ? 0 : 1;
  const text = RECORD[line][1] ?? "";
  const typed = Math.min(text.length, Math.max(0, (t - recordPlan.starts[line]) * 1.6));
  return { x: TERM_X + (2 + typed) * CHAR, y: lineY(RECORD.length, line) };
};

export const Record = () => {
  const frame = useCurrentFrame();
  // The camera trails the cursor: average its position over the last 10 frames.
  const trail = Array.from({ length: 10 }, (_, k) => cursor(frame - k));
  const cx = trail.reduce((s, c) => s + c.x, 0) / trail.length;
  const cy = trail.reduce((s, c) => s + c.y, 0) / trail.length;
  const release = keys(frame, [[recordOutput - 6, 0], [recordOutput + 20, 1]], Easing.bezier(0.65, 0, 0.35, 1));
  const zoom = mix(1.75, 1, release) * keys(frame, [[recordOutput + 20, 1], [180, 1.035]]);
  const x = mix(Math.max(900, cx - 180), 960, release);
  const y = mix(cy + 20, 540, release);

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink, ...whip(frame, 180, { in: 1, out: 1 }) }}>
      <Stage style={{ transform: focus(x, y, zoom) }}>
        <Split
          left={
            <>
              <Eyebrow at={recordOutput + 8}>01 · Record</Eyebrow>
              <Words text="Run a named test scenario." at={recordOutput + 12} style={TITLE} />
              <Sub at={recordOutput + 22}>GrantTrace watches the GitHub REST calls your code makes. No code changes for standard Octokit.</Sub>
            </>
          }
          right={<Terminal lines={RECORD} start={RECORD_START} width={1100} enterAt={0} />}
        />
      </Stage>
    </AbsoluteFill>
  );
};

// --------------------------------------------------------------- pipeline

const STEPS = [
  ["Scenario behavior", "issue-triage"],
  ["REST routes", "POST …/issues/{n}/comments"],
  ["Permissions", "issues: write"],
  ["granttrace.lock.json", "committed to Git"],
];
const GAP = 700;
const NODE_W = 400;
const camX = (f: number) => keys(f, [[0, -120], [70, 3 * GAP], [82, 3 * GAP], [102, 1.5 * GAP]], Easing.inOut(Easing.cubic));
export const PIPELINE_POPS = STEPS.map((_, i) => {
  for (let f = 0; f < 120; f++) if (camX(f) >= i * GAP - 330) return f;
  return 0;
});

export const Pipeline = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const zoom = keys(frame, [[0, 1.25], [80, 1.25], [102, 0.7]], Easing.inOut(Easing.cubic));
  const cy = keys(frame, [[80, 0], [102, -70]], Easing.inOut(Easing.cubic));
  const x = camX(frame);
  // Lines stay drawn once the camera has passed them, including during the pull-back.
  const reached = camX(Math.min(frame, 82));

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink, ...whip(frame, 120, { in: 1 }) }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${960 - x * zoom}px, ${540 - cy * zoom}px) scale(${zoom})`,
        }}
      >
        <svg style={{ position: "absolute", left: 0, top: -20, overflow: "visible" }} width={3 * GAP} height={40}>
          {STEPS.slice(0, -1).map((_, i) => {
            const from = i * GAP + NODE_W / 2 + 14;
            const to = (i + 1) * GAP - NODE_W / 2 - 14;
            const drawn = Math.min(1, Math.max(0, (reached + 140 - from) / (to - from)));
            const head = from + (to - from) * drawn;
            return (
              <g key={i}>
                <line x1={from} y1={20} x2={head} y2={20} stroke={ink} strokeWidth={3} strokeLinecap="round" opacity={drawn > 0 ? 1 : 0} />
                {drawn > 0 && drawn < 1 && <circle cx={head} cy={20} r={7} fill={ink} />}
              </g>
            );
          })}
        </svg>
        {STEPS.map(([label, detail], i) => {
          const p = pop(frame, PIPELINE_POPS[i], fps, 12);
          const last = i === STEPS.length - 1;
          return (
            <div
              key={label}
              style={{
                position: "absolute",
                left: i * GAP - NODE_W / 2,
                top: -48,
                width: NODE_W,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 20,
                opacity: Math.min(1, p * 1.5),
                transform: `scale(${0.7 + 0.3 * p})`,
              }}
            >
              <div
                style={{
                  alignSelf: "stretch",
                  height: 96,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 18,
                  fontFamily: last ? mono : undefined,
                  fontSize: last ? 27 : 31,
                  fontWeight: 600,
                  border: `1px solid ${last ? ink : hairline}`,
                  background: last ? ink : "#fff",
                  color: last ? "#fff" : ink,
                  boxShadow: last ? "0 24px 60px rgba(0,0,0,0.2)" : "0 14px 30px rgba(0,0,0,0.05)",
                }}
              >
                {label}
              </div>
              <div style={{ fontFamily: mono, fontSize: 22, color: muted }}>{detail}</div>
            </div>
          );
        })}
      </div>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 380 }}>
        <Words text="One reviewable contract, built from behavior." at={88} stagger={2} style={{ ...TITLE, justifyContent: "center" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ drift

export const Drift = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const slam = (at: number) => {
    const p = pop(frame, at, fps, 14);
    return { display: "inline-block", opacity: Math.min(1, p * 2), transform: `scale(${1.4 - 0.4 * p})`, filter: `blur(${Math.max(0, 1 - p) * 14}px)` };
  };
  return (
    <AbsoluteFill style={{ background: "#050505", color: "#fff", fontFamily: sans }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 34, transform: `scale(${keys(frame, [[0, 1.06], [60, 1]])})` }}>
        <div style={{ fontSize: 156, fontWeight: 700, letterSpacing: -5.5, display: "flex", gap: 36 }}>
          <span style={slam(-3)}>Permission</span>
          <span style={slam(4)}>drift</span>
        </div>
        <Words
          text="becomes a code review decision."
          at={22}
          stagger={3}
          style={{ fontSize: 60, fontWeight: 600, letterSpacing: -1.6, color: "#7a7a7a", justifyContent: "center" }}
          accent={["decision."]}
          accentStyle={{ color: "#fff" }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ----------------------------------------------------------------- review

const CHECK: Line[] = [
  ["cmd", "pnpm exec granttrace check"],
  ["blank"],
  ["head", "GrantTrace contract review required"],
  ["blank"],
  ["label", "Changes 1 permission · 1 scenario · 1 route"],
  ["blank"],
  ["label", "New permission"],
  ["strong", "issues: write"],
  ["blank"],
  ["label", "Observed in"],
  ["body", "Route     POST /repos/{owner}/{repo}/issues/{issue_number}/comments"],
  ["body", "Scenarios issue-triage"],
  ["body", "Evidence  Runtime response header, Pinned permission catalog"],
];
const REVIEW_START = 6;
export const REVIEW_TYPING = { at: REVIEW_START, frames: schedule(CHECK).typed };
export const REVIEW_PUNCH = 60;

export const Review = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const punch = pop(frame, REVIEW_PUNCH - 4, fps, 15) * keys(frame, [[100, 1], [112, 0]], Easing.inOut(Easing.cubic));
  const chipY = lineY(CHECK.length, 7);
  const zoom = mix(keys(frame, [[0, 1], [56, 1.02]]), 1.9, punch);
  const callout = pop(frame, REVIEW_PUNCH + 8, fps);

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink, ...whip(frame, 120, { out: 1 }) }}>
      <Stage style={{ transform: focus(mix(960, 1150, punch), mix(540, chipY, punch), zoom) }}>
        <Split
          left={
            <>
              <Eyebrow at={4}>02 · Review</Eyebrow>
              <Words text="Every new permission gets reviewed." at={8} style={TITLE} />
              <Sub at={18}>Intentional changes get a normal review. Unexplained ones block CI.</Sub>
            </>
          }
          right={<Terminal lines={CHECK} start={REVIEW_START} width={1100} enterAt={0} highlight={{ line: 7, at: REVIEW_PUNCH }} />}
        />
        <div
          style={{
            position: "absolute",
            left: TERM_X + 13 * CHAR + 30,
            top: chipY - 17,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontFamily: mono,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "#0a0a0a",
            background: "#bdbdbd",
            borderRadius: 7,
            padding: "7px 11px",
            opacity: Math.min(1, callout * 1.5),
            transform: `translateX(${(1 - callout) * -16}px)`,
          }}
        >
          ← needs review · blocks CI
        </div>
      </Stage>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- inspect

const INSPECT: Line[] = [
  ["cmd", "pnpm exec granttrace scenario inspect issue-triage"],
  ["blank"],
  ["head", "GrantTrace"],
  ["blank"],
  ["body", "Scenario: issue-triage"],
  ["body", "Observed: 4 GitHub REST operations"],
  ["blank"],
  ["label", "Selected permission contract"],
  ["strong", "  issues: write"],
  ["blank"],
  ["label", "Resolved routes"],
  ["body", "  POST /repos/{owner}/{repo}/issues/{issue_number}/comments"],
  ["dim", "    Evidence  Runtime response header, Pinned permission catalog"],
  ["blank"],
  ["dim", "Read-only analysis of this recording."],
];
const STAMP_COMMAND = "granttrace scenario inspect";
const SPLIT_AT = 36;
const INSPECT_START = 44;
export const INSPECT_STAMP_TYPING = { at: 8, frames: Math.ceil(STAMP_COMMAND.length / 1.6) };
export const INSPECT_TYPING = { at: INSPECT_START, frames: schedule(INSPECT, 4).typed };
export const INSPECT_HIGHLIGHT = 96;
export const FACT_TICKS = [104, 112, 120, 128];
const FACTS = ["Read-only", "Never reruns the scenario", "No GitHub access", "Works in CI"];

export const Inspect = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const stamp = pop(frame, 0, fps, 12);
  const typed = STAMP_COMMAND.slice(0, Math.max(0, Math.floor((frame - 8) * 1.6)));
  const through = keys(frame, [[170, 0], [180, 1]], Easing.in(Easing.cubic));

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink }}>
      {frame < SPLIT_AT && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, ...whip(frame, SPLIT_AT, { out: 1, axis: "y" }) }}>
          <div
            style={{
              fontFamily: mono,
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 5,
              color: "#fff",
              background: ink,
              borderRadius: 14,
              padding: "14px 28px",
              opacity: Math.min(1, stamp * 2),
              transform: `scale(${2.4 - 1.4 * stamp}) rotate(${(1 - stamp) * -6}deg)`,
            }}
          >
            NEW
          </div>
          <div style={{ fontFamily: mono, fontSize: 76, fontWeight: 600, letterSpacing: -1.5, whiteSpace: "pre" }}>
            {typed}
            <span style={{ background: ink, color: ink }}> </span>
          </div>
        </AbsoluteFill>
      )}
      {frame >= SPLIT_AT && (
        <AbsoluteFill
          style={{
            ...whip(frame - SPLIT_AT, 180, { in: 1, axis: "y" }),
            opacity: 1 - through,
          }}
        >
          <Stage style={{ transform: `scale(${keys(frame, [[SPLIT_AT, 1], [170, 1.04]]) + through * 0.35})`, filter: through > 0 ? `blur(${through * 24}px)` : undefined }}>
            <Split
              left={
                <>
                  <Eyebrow at={SPLIT_AT + 4} inverted>New · scenario inspect</Eyebrow>
                  <Words text="Inspect any saved recording." at={SPLIT_AT + 8} style={TITLE} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
                    {FACTS.map((fact, i) => {
                      const p = pop(frame, FACT_TICKS[i], fps, 12);
                      return (
                        <div key={fact} style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 27, color: "#333", opacity: Math.min(1, p * 2), transform: `translateX(${(1 - p) * -20}px)` }}>
                          <svg width="26" height="26" viewBox="0 0 26 26" style={{ transform: `scale(${p})` }}>
                            <circle cx="13" cy="13" r="13" fill={ink} />
                            <path d="M7.5 13.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {fact}
                        </div>
                      );
                    })}
                  </div>
                </>
              }
              right={
                <Terminal lines={INSPECT} start={INSPECT_START} typeSpeed={4} width={1100} enterAt={SPLIT_AT} highlight={{ line: 8, at: INSPECT_HIGHLIGHT }} />
              }
            />
          </Stage>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ outro

const INSTALL = "pnpm add -D granttrace@beta";
export const OUTRO_TYPING = { at: 30, frames: Math.ceil(INSTALL.length / 1.6) };

export const Outro = () => {
  const frame = useCurrentFrame();
  const fps = useFps();
  const slam = pop(frame, 0, fps, 13);
  const box = pop(frame, 24, fps, 14);
  const typed = INSTALL.slice(0, Math.max(0, Math.floor((frame - OUTRO_TYPING.at) * 1.6)));
  const done = typed.length === INSTALL.length;
  const fadeOut = interpolate(frame, [166, 180], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: paper, fontFamily: sans, color: ink }}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 46, opacity: fadeOut, transform: `scale(${keys(frame, [[0, 1.04], [180, 1]])})` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
          <div style={{ transform: `scale(${1.5 - 0.5 * slam})` }}>
            <Mark size={128} start={-6} />
          </div>
          <Letters text="GrantTrace" at={6} style={{ fontSize: 88, fontWeight: 700, letterSpacing: -2.7 }} />
        </div>
        <div
          style={{
            fontFamily: mono,
            fontSize: 32,
            padding: "20px 34px",
            borderRadius: 14,
            background: "#0a0a0a",
            color: "#f5f5f5",
            minWidth: 640,
            opacity: Math.min(1, box * 1.5),
            transform: `translateY(${(1 - box) * 24}px)`,
          }}
        >
          <span style={{ color: "#6b6b6b" }}>$ </span>
          {typed}
          {(!done || Math.floor(frame / 15) % 2 === 0) && <span style={{ background: "#f5f5f5", color: "#f5f5f5" }}> </span>}
        </div>
        <Words
          text="toxfied.github.io/GrantTrace · Open source · MIT"
          at={56}
          stagger={2}
          style={{ fontSize: 27, color: muted, justifyContent: "center", columnGap: "0.5em" }}
          accent={["toxfied.github.io/GrantTrace"]}
          accentStyle={{ color: ink, fontWeight: 600 }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
