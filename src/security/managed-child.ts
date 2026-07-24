import { spawn } from "node:child_process";

export type ManagedChildResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  processTreeCleanupFailed: boolean;
  spawnFailed: boolean;
  timedOut: boolean;
  interruptedBy: "SIGINT" | "SIGTERM" | null;
};

export function runManagedChild(input: {
  command: string;
  args: string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  timeoutMs: number;
  forceKillAfterMs?: number;
}): Promise<ManagedChildResult> {
  return new Promise((resolveResult) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      detached: process.platform !== "win32",
      env: input.environment,
      shell: false,
      stdio: "inherit",
    });
    let spawnFailed = false;
    let timedOut = false;
    let interruptedBy: ManagedChildResult["interruptedBy"] = null;
    let forceKillTimer: NodeJS.Timeout | null = null;
    const terminate = (signal: NodeJS.Signals) => {
      killProcessTree(child.pid, signal, child);
    };
    const scheduleForceKill = () => {
      if (forceKillTimer !== null) {
        return;
      }
      forceKillTimer = setTimeout(() => {
        terminate("SIGKILL");
      }, input.forceKillAfterMs ?? 5_000);
      forceKillTimer.unref();
    };
    const interrupt = () => {
      interruptedBy ??= "SIGINT";
      terminate("SIGINT");
      scheduleForceKill();
    };
    const terminateSignal = () => {
      interruptedBy ??= "SIGTERM";
      terminate("SIGTERM");
      scheduleForceKill();
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", terminateSignal);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      scheduleForceKill();
    }, input.timeoutMs);
    timeout.unref();

    child.once("error", () => {
      spawnFailed = true;
    });
    child.once("close", async (exitCode, signal) => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminateSignal);
      clearTimeout(timeout);
      if (forceKillTimer !== null) {
        clearTimeout(forceKillTimer);
      }
      const processTreeCleanupFailed = !(await killRemainingProcessGroup(
        child.pid,
      ));
      resolveResult({
        exitCode,
        signal,
        processTreeCleanupFailed,
        spawnFailed,
        timedOut,
        interruptedBy,
      });
    });
  });
}

function killProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  child: ReturnType<typeof spawn>,
): void {
  if (process.platform !== "win32" && pid !== undefined) {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through to direct-child termination.
    }
  }
  child.kill(signal);
}

async function killRemainingProcessGroup(
  pid: number | undefined,
): Promise<boolean> {
  if (process.platform === "win32" || pid === undefined) {
    return true;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    return isNoSuchProcess(error);
  }

  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => {
      setTimeout(resolveDelay, 10);
    });
    try {
      process.kill(-pid, 0);
    } catch (error) {
      return isNoSuchProcess(error);
    }
  }
  return false;
}

function isNoSuchProcess(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ESRCH"
  );
}
