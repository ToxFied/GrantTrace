import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Eyebrow, Scene, Split, Sub, Title } from "./Layout";
import { Mark } from "./Mark";
import { Terminal, type Line } from "./Terminal";
import { chip, enter, faint, hairline, ink, mono, muted, progress } from "./theme";

const Wordmark = ({ at, size }: { at: number; size: number }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ ...enter(frame, at, 16), fontSize: size, fontWeight: 700, letterSpacing: -size * 0.031 }}>
      GrantTrace
    </div>
  );
};

const Beta = ({ at }: { at: number }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        ...enter(frame, at, 10),
        fontFamily: mono,
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: 2.2,
        color: "#5f5f5f",
        background: chip,
        border: "1px solid #d8d8d8",
        borderRadius: 12,
        padding: "10px 18px",
      }}
    >
      BETA
    </div>
  );
};

export const Intro = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <Mark size={150} start={0} />
          <Wordmark at={20} size={96} />
          <Beta at={30} />
        </div>
        <div style={{ ...enter(frame, 40, 14), fontSize: 34, color: muted }}>
          See which GitHub permissions each tested behavior actually uses.
        </div>
        <div
          style={{
            width: 1300,
            height: 1,
            background: hairline,
            transform: `scaleX(${progress(frame, 48, 30)})`,
          }}
        />
      </AbsoluteFill>
    </Scene>
  );
};

const PERMISSIONS = [
  ["Actions", "Read-only"],
  ["Checks", "Read and write"],
  ["Contents", "Read and write"],
  ["Issues", "Read and write"],
  ["Pull requests", "Read and write"],
  ["Metadata", "Read-only"],
];

export const Problem = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 120 }}>
        <div style={{ width: 640, display: "flex", flexDirection: "column", gap: 26 }}>
          <Eyebrow at={4}>The problem</Eyebrow>
          <Title at={8} color={faint}>GitHub shows what your app can access.</Title>
          <Title at={40}>It doesn&apos;t show which behavior needs it.</Title>
        </div>
        <div
          style={{
            ...enter(frame, 14, 30),
            width: 700,
            border: `1px solid ${hairline}`,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: "0 30px 80px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ padding: "24px 32px", fontSize: 24, fontWeight: 600, borderBottom: `1px solid ${hairline}`, background: "#fafafa" }}>
            Repository permissions
          </div>
          {PERMISSIONS.map(([name, level], i) => {
            const why = progress(frame, 62 + i * 5, 12);
            return (
              <div
                key={name}
                style={{
                  ...enter(frame, 22 + i * 4, 10, 12),
                  display: "flex",
                  alignItems: "center",
                  height: 76,
                  padding: "0 32px",
                  borderTop: i === 0 ? "none" : `1px solid #efefef`,
                  fontSize: 25,
                }}
              >
                <div style={{ flex: 1 }}>{name}</div>
                <div
                  style={{
                    fontSize: 20,
                    color: muted,
                    border: `1px solid ${hairline}`,
                    borderRadius: 9,
                    padding: "6px 14px",
                  }}
                >
                  {level}
                </div>
                <div
                  style={{
                    marginLeft: 18,
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    background: ink,
                    color: "#fff",
                    fontSize: 20,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: why,
                    transform: `scale(${0.6 + why * 0.4})`,
                  }}
                >
                  ?
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

const RECORD: Line[] = [
  ["cmd", "pnpm exec granttrace record issue-triage -- \\"],
  ["cont", "pnpm test -- issue-triage"],
  ["blank"],
  ["head", "GrantTrace recording started"],
  ["body", "Scenario issue-triage"],
  ["body", "Timeout 15m"],
  ["head", "GrantTrace record complete"],
  ["blank"],
  ["body", "Observed 4 GitHub REST operations"],
  ["blank"],
  ["label", "Next"],
  ["body", "granttrace check"],
];

export const Record = () => (
  <Scene>
    <Split
      left={
        <>
          <Eyebrow at={4}>01 · Record</Eyebrow>
          <Title at={8}>Run a named test scenario.</Title>
          <Sub at={16}>GrantTrace watches the GitHub REST calls your code makes. No code changes for standard Octokit.</Sub>
        </>
      }
      right={<Terminal lines={RECORD} start={24} width={1100} />}
    />
  </Scene>
);

const STEPS = [
  ["Scenario behavior", "issue-triage"],
  ["REST routes", "POST …/issues/{n}/comments"],
  ["Permissions", "issues: write"],
  ["granttrace.lock.json", "committed to Git"],
];

export const Pipeline = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 90 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24 }}>
          <Eyebrow at={2} center>How it works</Eyebrow>
          <Title at={6}>One reviewable contract, built from behavior.</Title>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {STEPS.map(([label, detail], i) => {
            const last = i === STEPS.length - 1;
            const at = 22 + i * 16;
            return (
              <div key={label} style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ ...enter(frame, at, 14), width: 360, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
                  <div
                    style={{
                      fontFamily: last ? mono : undefined,
                      fontSize: last ? 25 : 28,
                      fontWeight: 600,
                      alignSelf: "stretch",
                      height: 84,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 16,
                      border: `1px solid ${last ? ink : hairline}`,
                      background: last ? ink : "#fff",
                      color: last ? "#fff" : ink,
                      boxShadow: last ? "0 20px 50px rgba(0,0,0,0.18)" : "none",
                    }}
                  >
                    {label}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 19, color: muted }}>{detail}</div>
                </div>
                {!last && (
                  <div style={{ width: 64, height: 84, display: "flex", alignItems: "center", padding: "0 10px" }}>
                    <div
                      style={{
                        height: 2,
                        flex: 1,
                        background: ink,
                        borderRadius: 1,
                        transform: `scaleX(${progress(frame, at + 8, 12)})`,
                        transformOrigin: "left",
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </Scene>
  );
};

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

export const Review = () => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [100, 170], [1, 1.045], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Scene>
      <Split
        left={
          <>
            <Eyebrow at={4}>02 · Review</Eyebrow>
            <Title at={8}>Permission drift shows up in code review.</Title>
            <Sub at={16}>An intentional change gets a normal review. An unexplained one blocks CI.</Sub>
          </>
        }
        right={
          <div style={{ transform: `scale(${push})`, transformOrigin: "30% 45%" }}>
            <Terminal lines={CHECK} start={24} width={1100} highlight={{ line: 7, at: 96 }} />
          </div>
        }
      />
    </Scene>
  );
};

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

const FACTS = ["Read-only", "Never reruns the scenario", "No GitHub access", "Works in CI"];

export const Inspect = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <Split
        left={
          <>
            <Eyebrow at={4} inverted>New · scenario inspect</Eyebrow>
            <Title at={8}>Inspect any saved recording.</Title>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 6 }}>
              {FACTS.map((fact, i) => (
                <div key={fact} style={{ ...enter(frame, 90 + i * 8, 12), display: "flex", alignItems: "center", gap: 16, fontSize: 27, color: "#333" }}>
                  <svg width="26" height="26" viewBox="0 0 26 26">
                    <circle cx="13" cy="13" r="13" fill={ink} />
                    <path d="M7.5 13.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {fact}
                </div>
              ))}
            </div>
          </>
        }
        right={<Terminal lines={INSPECT} start={24} width={1100} highlight={{ line: 8, at: 110 }} />}
      />
    </Scene>
  );
};

export const Outro = () => {
  const frame = useCurrentFrame();
  return (
    <Scene>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 46 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Mark size={116} start={0} />
          <Wordmark at={12} size={80} />
        </div>
        <div
          style={{
            ...enter(frame, 26, 14),
            fontFamily: mono,
            fontSize: 30,
            padding: "20px 34px",
            borderRadius: 14,
            background: "#0a0a0a",
            color: "#f5f5f5",
          }}
        >
          <span style={{ color: "#6b6b6b" }}>$ </span>pnpm add -D granttrace@beta
        </div>
        <div style={{ ...enter(frame, 38, 12), fontSize: 26, color: muted, display: "flex", gap: 22 }}>
          <span style={{ color: ink, fontWeight: 600 }}>toxfied.github.io/GrantTrace</span>
          <span>·</span>
          <span>Open source</span>
          <span>·</span>
          <span>MIT</span>
        </div>
      </AbsoluteFill>
    </Scene>
  );
};
