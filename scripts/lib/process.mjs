import { spawn } from "node:child_process";

const DEFAULT_OUTPUT_LIMIT = 2 * 1024 * 1024;

export async function run(command, args, options = {}) {
  const {
    cwd,
    environment,
    expectedExitCodes = [0],
    outputLimit = DEFAULT_OUTPUT_LIMIT,
  } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputExceeded = false;

    const capture = (target, isStdout) => (chunk) => {
      if (outputExceeded) {
        return;
      }
      if (isStdout) {
        stdoutBytes += chunk.length;
      } else {
        stderrBytes += chunk.length;
      }
      if (stdoutBytes + stderrBytes > outputLimit) {
        outputExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      target.push(chunk);
    };

    child.stdout.on("data", capture(stdout, true));
    child.stderr.on("data", capture(stderr, false));
    child.once("error", () => {
      reject(new Error(`Could not start ${command}.`));
    });
    child.once("close", (code, signal) => {
      if (outputExceeded) {
        reject(new Error(`${command} exceeded the safe output limit.`));
        return;
      }
      if (
        signal !== null ||
        code === null ||
        !expectedExitCodes.includes(code)
      ) {
        reject(
          new Error(
            `${command} failed with ${
              signal === null ? `exit code ${String(code)}` : "a signal"
            }.`,
          ),
        );
        return;
      }
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export function portableEnvironment(overrides = {}) {
  const environment = {
    PATH: process.env.PATH,
    Path: process.env.Path,
    SystemRoot: process.env.SystemRoot,
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
    LANG: process.env.LANG ?? "C",
    LC_ALL: process.env.LC_ALL ?? "C",
    NO_COLOR: "1",
    CI: "1",
    ...overrides,
  };

  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value !== undefined),
  );
}
