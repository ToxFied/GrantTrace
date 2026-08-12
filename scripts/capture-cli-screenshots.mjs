import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetDirectory = join(projectRoot, "website", "public", "cli");
const tempProject = await mkdtemp(
  join(tmpdir(), "granttrace-cli-screenshots-"),
);
const environment = { ...process.env };
delete environment.CI;
delete environment.GITHUB_ACTIONS;
environment.NODE_NO_WARNINGS = "1";

await mkdir(assetDirectory, { recursive: true });

try {
  const tsxImport = fileURLToPath(import.meta.resolve("tsx"));
  const fixture = join(
    projectRoot,
    "test",
    "fixtures",
    "children",
    "instrumented.ts",
  );
  const command = [
    "pnpm exec granttrace record --no-review issue-triage -- \\",
    "pnpm test -- issue-triage",
  ].join("\n");

  await captureStep("01-record", command, 0, async () => {
    return runCliProcess([
      "record",
      "--no-review",
      "issue-triage",
      "--",
      process.execPath,
      "--import",
      tsxImport,
      fixture,
    ]);
  });

  await captureStep("02-review", "pnpm exec granttrace check", 6, async () => {
    return runCliProcess(["check"]);
  });

  await captureStep(
    "03-accept",
    "pnpm exec granttrace check --accept",
    0,
    async () => {
      return runCliProcess(["check", "--accept"]);
    },
  );
} finally {
  await rm(tempProject, { recursive: true, force: true });
}

async function captureStep(name, command, expectedExitCode, operation) {
  const result = await operation();
  if (result.code !== expectedExitCode) {
    throw new Error(
      `Screenshot ${name} exited ${String(result.code)}; expected ${String(expectedExitCode)}.`,
    );
  }
  const transcript = `${result.stdout}${result.stderr}`.trim() + "\n";
  const svgPath = join(tempProject, `${name}.svg`);
  const pngPath = join(assetDirectory, `${name}.png`);
  await writeFile(svgPath, terminalSvg(command, transcript));
  execFileSync("rsvg-convert", ["-o", pngPath, svgPath]);
}

function runCliProcess(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", fileURLToPath(import.meta.resolve("tsx")), join(projectRoot, "src", "cli", "bin.ts"), ...args],
      {
        cwd: tempProject,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function terminalSvg(command, transcript) {
  const commandLines = command.split("\n");
  const lines = [...commandLines, "", ...transcript.split("\n")];
  const lineHeight = 25;
  const padding = 34;
  const chromeHeight = 58;
  const width = 1280;
  const height = chromeHeight + padding * 2 + lines.length * lineHeight;
  const text = lines
    .map((line, index) => {
      const y = chromeHeight + padding + (index + 1) * lineHeight;
      const prompt =
        index === 0 ? "$ " : index < commandLines.length ? "> " : "";
      const content = escapeXml(`${prompt}${line}`);
      const fill = index < commandLines.length ? "#c9f27b" : lineColor(line);
      return `<text x="${padding}" y="${y}" fill="${fill}" class="terminal-text">${content}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .terminal-text { font: 17px Menlo, Monaco, 'SFMono-Regular', monospace; }
    .window-title { font: 14px Menlo, Monaco, 'SFMono-Regular', monospace; }
  </style>
  <rect width="${width}" height="${height}" fill="#050505"/>
  <rect width="${width}" height="${chromeHeight}" fill="#111111"/>
  <circle cx="28" cy="29" r="7" fill="#ff5f57"/>
  <circle cx="52" cy="29" r="7" fill="#febc2e"/>
  <circle cx="76" cy="29" r="7" fill="#28c840"/>
  <text x="${width / 2}" y="35" text-anchor="middle" fill="#9a9a9a" class="window-title">granttrace · local fixture</text>
  ${text}
</svg>`;
}

function lineColor(line) {
  if (
    /^GrantTrace .* (passed|accepted|complete|started|initialized)$/.test(line) ||
    line === "GrantTrace initialized" ||
    line === "GrantTrace is ready for local recording"
  ) {
    return "#9ee493";
  }
  if (line === "GrantTrace contract review required") {
    return "#ffd166";
  }
  if (
    /^Changes  |^New permission|^Decision|^Next|^Coverage|^Observed in|^Selected permission contract/.test(
      line,
    )
  ) {
    return "#78c7ff";
  }
  if (/^  [\w-]+: (read|write)$/.test(line)) {
    return "#9ee493";
  }
  if (line.startsWith("  ")) {
    return "#d7d7d7";
  }
  return "#f4f4f4";
}

function escapeXml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character],
  );
}
