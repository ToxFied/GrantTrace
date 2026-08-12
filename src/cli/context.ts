import { createInterface } from "node:readline/promises";

import type { LiveFixtureConfig } from "../proof/live-config.js";
import type { ProofExecutionDependencies } from "../proof/orchestrator.js";
import type { LocalOperationLock } from "../security/local-state.js";

export type CliContext = {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  confirm?: (question: string) => Promise<boolean>;
  proofDependencies?: ProofExecutionDependencies;
  loadLiveFixtureConfig?: (
    environment: NodeJS.ProcessEnv,
  ) => LiveFixtureConfig;
  recordDependencies?: {
    removeSession?: (path: string) => Promise<void>;
  };
  frontierDependencies?: {
    acquireOperationLock?: (cwd: string) => Promise<LocalOperationLock>;
  };
  keepDependencies?: {
    acquireOperationLock?: (cwd: string) => Promise<LocalOperationLock>;
  };
};

export function defaultCliContext(): CliContext {
  const color =
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env["NO_COLOR"] === undefined;
  const context: CliContext = {
    cwd: process.cwd(),
    environment: process.env,
    stdout: styledWriter(process.stdout, color),
    stderr: styledWriter(process.stderr, color),
  };
  if (process.stdin.isTTY && process.stdout.isTTY) {
    context.confirm = (question) => confirmInTerminal(question, color);
  }
  return context;
}

export function writeLine(
  stream: Pick<NodeJS.WriteStream, "write">,
  value: string,
): void {
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}

function styledWriter(
  stream: NodeJS.WriteStream,
  enabled: boolean,
): Pick<NodeJS.WriteStream, "write"> {
  return {
    write(value: string | Uint8Array): boolean {
      if (!enabled || typeof value !== "string") {
        return stream.write(value);
      }
      return stream.write(styleCliOutput(value));
    },
  };
}

/** Applies restrained ANSI styling only to stable human-readable CLI lines. */
export function styleCliOutput(value: string): string {
  const reset = "\u001b[0m";
  const bold = "\u001b[1m";
  const cyan = "\u001b[36m";
  const green = "\u001b[32m";
  const red = "\u001b[31m";
  const yellow = "\u001b[33m";

  return value
    .split("\n")
    .map((line) => {
      if (line === "") {
        return line;
      }
      if (
        /^GrantTrace .* (passed|accepted|complete|started|initialized)$/u.test(
          line,
        ) ||
        line === "GrantTrace initialized" ||
        line === "GrantTrace is ready for local recording"
      ) {
        return `${bold}${green}${line}${reset}`;
      }
      if (
        /^GrantTrace .* (failed|blocked|interrupted|timed out|not found)$/u.test(
          line,
        )
      ) {
        return `${bold}${red}${line}${reset}`;
      }
      if (
        line === "GrantTrace contract review required" ||
        line === "Not accepted" ||
        line === "Analysis blocked"
      ) {
        return `${bold}${yellow}${line}${reset}`;
      }
      if (
        [
          "Changes",
          "Decision",
          "Next",
          "Coverage",
          "Observed in",
          "Did you mean",
          "New permission",
          "Permission escalation",
          "No longer observed",
          "Observed access reduced",
          "Scenario added",
          "Scenario removed",
          "Route added",
          "Route removed",
          "Scenario attribution added",
          "Scenario attribution removed",
          "Scenario evidence provenance changed",
          "Route evidence changed",
          "Selected permission contract",
          "Observed permission contract",
          "Mandatory GitHub baseline (not selected or manually kept)",
        ].includes(line)
      ) {
        return `${bold}${cyan}${line}${reset}`;
      }
      if (line.startsWith("Changes  ")) {
        return `${bold}${cyan}${line}${reset}`;
      }
      if (/^  [\w-]+: (read|write)$/.test(line)) {
        return `${green}${line}${reset}`;
      }
      if (line.startsWith("  granttrace ")) {
        return `${bold}${line}${reset}`;
      }
      return line;
    })
    .join("\n");
}

async function confirmInTerminal(
  question: string,
  color: boolean,
): Promise<boolean> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const styledQuestion = color
      ? `\u001b[1m\u001b[36m${question}\u001b[0m`
      : question;
    const answer = (await prompt.question(styledQuestion)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
}
