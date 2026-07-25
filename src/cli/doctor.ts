import { access } from "node:fs/promises";
import { join } from "node:path";

import { readContractWithMetadata } from "../contract/serialize.js";
import {
  configuredPrivateKeyProvider,
  PrivateKeyProviderError,
  resolvePrivateKey,
} from "../security/private-key-provider.js";
import { LiveFixtureConfig } from "../proof/live-config.js";
import type { CliContext } from "./context.js";
import { writeLine } from "./context.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import {
  inspectLocalState,
  repairStaleOperationLock,
  stateIgnorePresent,
  type OperationLockRepairResult,
} from "../security/local-state.js";

export async function runDoctor(
  args: string[],
  context: CliContext,
): Promise<ExitCodeValue> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    writeLine(
      context.stdout,
      [
        "Check local and optional live-proof prerequisites",
        "",
        "Usage",
        "  granttrace doctor",
        "  granttrace doctor --repair",
        "",
        "--repair removes only a private operation lock whose owner process is proven gone.",
        "",
        "Diagnostics never print credential values or fixture identities.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  const repair =
    args.length === 1 && args[0] === "--repair";
  if (args.length > 0 && !repair) {
    writeLine(
      context.stderr,
      "Usage: granttrace doctor [--repair]",
    );
    return ExitCode.usage;
  }

  const lines = ["GrantTrace doctor", ""];
  let blocking = false;
  let repairResult: OperationLockRepairResult = { status: "absent" };
  if (repair) {
    repairResult = await repairStaleOperationLock(context.cwd);
    if (repairResult.status === "removed") {
      lines.push(
        diagnostic(
          "PASS",
          repairResult.reason === "dead_pid"
            ? "Removed a private operation lock whose owner process is gone"
            : "Removed an expired empty operation lock",
        ),
      );
    } else if (repairResult.status === "not_removed") {
      lines.push(
        diagnostic("FAIL", operationLockRepairMessage(repairResult.reason)),
      );
      blocking = true;
    }
  }

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  const nodeReady = Number.isInteger(nodeMajor) && nodeMajor >= 22;
  lines.push(
    diagnostic(
      nodeReady ? "PASS" : "FAIL",
      nodeReady ? `Node ${process.versions.node}` : "Node 22+ required",
    ),
  );
  blocking ||= !nodeReady;

  const ignored = await stateIgnorePresent(context.cwd);
  lines.push(
    diagnostic(
      ignored ? "PASS" : "FAIL",
      ignored ? ".granttrace/ is ignored" : ".granttrace/ is not ignored",
    ),
  );
  blocking ||= !ignored;

  const state = await inspectLocalState(context.cwd);
  lines.push(
    diagnostic(
      state.ready ? "PASS" : "FAIL",
      state.ready
        ? `Local state is private; ${state.observationFiles} scenario recording${
        state.observationFiles === 1 ? "" : "s"
          } found`
        : localStateMessage(state.issue),
    ),
  );
  blocking ||= !state.ready;
  if (state.staleSessions > 0) {
    lines.push(
      diagnostic(
        "FAIL",
        `${state.staleSessions} stale session artifact${
          state.staleSessions === 1 ? "" : "s"
        } require review`,
      ),
    );
    blocking = true;
  }

  const contract = await contractState(context.cwd);
  lines.push(
    diagnostic(
      contract.invalid ? "FAIL" : contract.ready ? "PASS" : "INFO",
      contract.message,
    ),
  );
  blocking ||= contract.invalid;

  const provider = configuredPrivateKeyProvider(context.environment);
  const liveAttempted =
    provider !== null ||
    [
      "GRANTTRACE_APP_ID",
      "GRANTTRACE_INSTALLATION_ID",
      "GRANTTRACE_APP_PRIVATE_KEY",
      "GRANTTRACE_APP_PRIVATE_KEY_FILE",
      "GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE",
      "GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT",
      "GRANTTRACE_LIVE_OWNER",
      "GRANTTRACE_LIVE_REPOSITORY",
      "GRANTTRACE_LIVE_ISSUE_NUMBER",
      "GRANTTRACE_LIVE_CONFIRM_DISPOSABLE",
    ].some((name) => (context.environment[name]?.trim().length ?? 0) > 0);
  let liveReady = false;
  let providerProblem: string | null = null;
  try {
    resolvePrivateKey(context.environment);
    LiveFixtureConfig.load(context.environment);
    liveReady = true;
  } catch (error) {
    liveReady = false;
    providerProblem =
      error instanceof PrivateKeyProviderError &&
      error.code !== "missing_provider"
        ? providerFailureMessage(error.code)
        : null;
  }
  lines.push(
    diagnostic(
      liveReady
        ? "PASS"
        : !liveAttempted && providerProblem === null
          ? "INFO"
          : "WARN",
      liveReady
        ? `Optional live proof is configured (${provider ?? "unknown"} provider)`
        : providerProblem ??
            (!liveAttempted
              ? "Optional live proof is not configured"
              : provider === null
                ? "Optional live proof configuration is incomplete"
                : `Optional live proof configuration is incomplete (${provider} provider)`),
    ),
  );

  lines.push("");
  if (blocking) {
    lines.push(
      "Result",
      "  Local verification is blocked.",
      "",
      "Next",
      "  Fix the failed item above, verify any live mutation residue, then run granttrace doctor again.",
      "",
    );
  } else if (!state.ready) {
    lines.push(
      "Result",
      "  Runtime is compatible; local setup is not initialized.",
      "",
      "Next",
      "  granttrace init",
      "",
    );
  } else {
    lines.push(
      "Result",
      "  Local recording and checks are ready.",
      "",
      "Next",
      state.observationFiles > 0 || contract.ready
        ? "  granttrace check"
        : "  Record a scenario, then run granttrace check.",
      "",
    );
  }

  writeLine(blocking ? context.stderr : context.stdout, lines.join("\n"));
  return blocking ? ExitCode.analysisFailure : ExitCode.success;
}

function providerFailureMessage(
  code: PrivateKeyProviderError["code"],
): string {
  switch (code) {
    case "unsafe_file_permissions":
      return "Private-key file must be owned by you, mode 0600, in an owned mode-0700 directory";
    case "invalid_file":
      return "Private-key file path or contents are invalid";
    case "unsupported_keychain":
      return "macOS Keychain provider is unavailable on this platform";
    case "invalid_keychain_configuration":
      return "macOS Keychain service/account configuration is incomplete";
    case "keychain_lookup_failed":
      return "macOS Keychain item could not be read";
    case "missing_provider":
      return "No private-key provider is configured";
    case "multiple_providers":
      return "Choose exactly one private-key provider";
  }
}

function operationLockRepairMessage(
  reason: Extract<
    OperationLockRepairResult,
    { status: "not_removed" }
  >["reason"],
): string {
  switch (reason) {
    case "empty_lock_too_young":
      return "Empty operation lock is too recent to prove stale; it was not removed";
    case "live_pid":
      return "Operation lock owner is still running; it was not removed";
    case "malformed_owner":
      return "Operation lock owner record is malformed; it was not removed";
    case "unsafe_lock":
      return "Operation lock is unsafe or changed during inspection; it was not removed";
    case "unverifiable_pid":
      return "Operation lock owner cannot be verified as gone; it was not removed";
  }
}

function diagnostic(
  level: "FAIL" | "INFO" | "PASS" | "WARN",
  message: string,
): string {
  return `  ${level.padEnd(4, " ")}  ${message}`;
}

function localStateMessage(
  issue: Awaited<ReturnType<typeof inspectLocalState>>["issue"],
): string {
  switch (issue) {
    case "missing":
      return "Local state is not initialized";
    case "unsafe_root":
      return "Local state root is not a private directory owned by the current user";
    case "unsafe_observations":
      return "Observation state is not a private directory owned by the current user";
    case "unsafe_artifact":
      return "Local state contains an unsafe mode, symlink, or artifact";
    case null:
      return "Local state is ready";
  }
}

async function contractState(cwd: string): Promise<{
  ready: boolean;
  invalid: boolean;
  message: string;
}> {
  try {
    const result = await readContractWithMetadata(
      join(cwd, "granttrace.lock.json"),
    );
    if (result.migratedFromV1 || result.migratedFromLegacyV2) {
      return {
        ready: false,
        invalid: false,
        message: result.migratedFromV1
          ? "Contract is schema v1; run granttrace check --accept after review"
          : "Contract needs scenario-provenance review; run granttrace check",
      };
    }
    return {
      ready: true,
      invalid: false,
      message: `Schema v2 contract is valid (${result.contract.scenarios.length} scenario${
        result.contract.scenarios.length === 1 ? "" : "s"
      })`,
    };
  } catch (error) {
    if (await pathExists(join(cwd, "granttrace.lock.json"))) {
      return {
        ready: false,
        invalid: true,
        message: "Contract exists but is invalid",
      };
    }
    return {
      ready: false,
      invalid: false,
      message: "No accepted contract yet",
    };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
