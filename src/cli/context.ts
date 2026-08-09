import { createInterface } from "node:readline/promises";

import type { ProofExecutionDependencies } from "../proof/orchestrator.js";
import type { LiveFixtureConfig } from "../proof/live-config.js";
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
  const context: CliContext = {
    cwd: process.cwd(),
    environment: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
  if (process.stdin.isTTY && process.stdout.isTTY) {
    context.confirm = confirmInTerminal;
  }
  return context;
}

export function writeLine(
  stream: Pick<NodeJS.WriteStream, "write">,
  value: string,
): void {
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}

async function confirmInTerminal(question: string): Promise<boolean> {
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await prompt.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    prompt.close();
  }
}
