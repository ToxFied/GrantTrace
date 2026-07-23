import { access, readFile, readdir, stat } from "node:fs/promises";
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
        "",
        "Diagnostics never print credential values or fixture identities.",
        "",
      ].join("\n"),
    );
    return ExitCode.success;
  }
  if (args.length > 0) {
    writeLine(context.stderr, "Usage: granttrace doctor");
    return ExitCode.usage;
  }

  const lines = ["GrantTrace doctor", ""];
  let blocking = false;

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
  const nodeReady = Number.isInteger(nodeMajor) && nodeMajor >= 22;
  lines.push(status(nodeReady, `Node ${process.versions.node}`, "Node 22+ required"));
  blocking ||= !nodeReady;

  const ignored = await stateIgnorePresent(context.cwd);
  lines.push(status(ignored, ".granttrace/ is ignored", ".granttrace/ is not ignored"));

  const state = await localState(context.cwd);
  lines.push(
    status(
      state.ready,
      `Local state is private; ${state.observationFiles} scenario recording${
        state.observationFiles === 1 ? "" : "s"
      } found`,
      "Local state is not initialized",
    ),
  );

  const contract = await contractState(context.cwd);
  lines.push(status(contract.ready, contract.message, contract.message));
  blocking ||= contract.invalid;

  const provider = configuredPrivateKeyProvider(context.environment);
  let liveReady = false;
  let providerProblem: string | null = null;
  if (provider !== null) {
    try {
      resolvePrivateKey(context.environment);
      LiveFixtureConfig.load(context.environment);
      liveReady = true;
    } catch (error) {
      liveReady = false;
      providerProblem =
        error instanceof PrivateKeyProviderError
          ? providerFailureMessage(error.code)
          : null;
    }
  }
  lines.push(
    status(
      liveReady,
      `Optional live proof is configured (${provider ?? "unknown"} provider)`,
      provider === null
        ? "Optional live proof is not configured"
        : providerProblem ??
          `Optional live proof configuration is incomplete (${provider} provider)`,
    ),
  );

  lines.push("");
  if (blocking) {
    lines.push(
      "Result",
      "  Local verification is blocked.",
      "",
      "Next",
      "  Fix the failed item above, then run granttrace doctor again.",
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
      contract.ready
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

function status(ok: boolean, success: string, failure: string): string {
  return `  ${ok ? "PASS" : "INFO"}  ${ok ? success : failure}`;
}

async function stateIgnorePresent(cwd: string): Promise<boolean> {
  try {
    const content = await readFile(join(cwd, ".gitignore"), "utf8");
    return content
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .includes(".granttrace/");
  } catch {
    return false;
  }
}

async function localState(cwd: string): Promise<{
  ready: boolean;
  observationFiles: number;
}> {
  const stateDirectory = join(cwd, ".granttrace");
  try {
    const stateStat = await stat(stateDirectory);
    if (!stateStat.isDirectory() || (stateStat.mode & 0o077) !== 0) {
      return { ready: false, observationFiles: 0 };
    }
    const observationDirectory = join(stateDirectory, "observations");
    await access(observationDirectory);
    const entries = await readdir(observationDirectory, { withFileTypes: true });
    return {
      ready: true,
      observationFiles: entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(".ndjson"),
      ).length,
    };
  } catch {
    return { ready: false, observationFiles: 0 };
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
    if (result.migratedFromV1) {
      return {
        ready: false,
        invalid: false,
        message: "Contract is schema v1; run granttrace check --accept after review",
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
