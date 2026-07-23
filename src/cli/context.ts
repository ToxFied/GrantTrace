import type { ProofExecutionDependencies } from "../proof/orchestrator.js";

export type CliContext = {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
  proofDependencies?: ProofExecutionDependencies;
};

export function defaultCliContext(): CliContext {
  return {
    cwd: process.cwd(),
    environment: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

export function writeLine(
  stream: Pick<NodeJS.WriteStream, "write">,
  value: string,
): void {
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}
