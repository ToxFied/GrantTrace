import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.env["GRANTTRACE_SESSION_DIR"];
const scenario = process.env["GRANTTRACE_SCENARIO"];
if (directory === undefined || scenario === undefined) {
  process.exit(2);
}

await writeFile(join(directory, "plugin-loaded"), "loaded\n", {
  mode: 0o600,
});
await writeFile(
  join(directory, "observations.ndjson"),
  `${JSON.stringify({
    schemaVersion: 1,
    scenario,
    method: "GET",
    routeTemplate: "/repos/{owner}/{repo}/contents/{path}",
    status: 200,
    requirements: [[{ permission: "contents", level: "read" }]],
    evidenceSource: "runtime_header",
    finding: null,
  })}\n`,
  { mode: 0o600 },
);

const descendantPidPath = process.argv[2];
if (descendantPidPath !== undefined) {
  spawn(
    process.execPath,
    [
      "-e",
      [
        'const fs = require("node:fs");',
        'process.on("SIGTERM", () => {});',
        'process.on("SIGINT", () => {});',
        `fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid), { mode: 0o600 });`,
        "setInterval(() => undefined, 1000);",
      ].join(""),
    ],
    {
      detached: false,
      stdio: "ignore",
    },
  ).unref();
}

process.once("SIGINT", () => {
  process.exit(0);
});
setInterval(() => undefined, 1_000);
