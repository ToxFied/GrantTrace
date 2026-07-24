import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";

import { z } from "zod";

const MAX_PRIVATE_KEY_BYTES = 32_768;
const KeychainLabelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9 ._:@/-]+$/u);

export type PrivateKeyProviderKind = "environment" | "file" | "keychain";

export class PrivateKeyProviderError extends Error {
  public readonly code:
    | "missing_provider"
    | "multiple_providers"
    | "invalid_file"
    | "unsafe_file_permissions"
    | "unsupported_keychain"
    | "invalid_keychain_configuration"
    | "keychain_lookup_failed";

  public constructor(code: PrivateKeyProviderError["code"]) {
    super(`The private-key provider is unavailable or unsafe (${code}).`);
    this.name = "PrivateKeyProviderError";
    this.code = code;
  }
}

export function resolvePrivateKey(environment: NodeJS.ProcessEnv): {
  kind: PrivateKeyProviderKind;
  value: string;
} {
  const inline = environment["GRANTTRACE_APP_PRIVATE_KEY"];
  const file = environment["GRANTTRACE_APP_PRIVATE_KEY_FILE"];
  const keychainService =
    environment["GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE"];
  const keychainAccount =
    environment["GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT"];
  const hasInline = hasNonBlankValue(inline);
  const hasFile = hasNonBlankValue(file);
  const hasKeychainService = hasNonBlankValue(keychainService);
  const hasKeychainAccount = hasNonBlankValue(keychainAccount);
  const hasKeychain =
    hasKeychainService || hasKeychainAccount;
  const providers = [
    hasInline ? "environment" : null,
    hasFile ? "file" : null,
    hasKeychain ? "keychain" : null,
  ].filter((provider) => provider !== null);

  if (providers.length === 0) {
    throw new PrivateKeyProviderError("missing_provider");
  }
  if (providers.length > 1) {
    throw new PrivateKeyProviderError("multiple_providers");
  }

  if (hasInline && inline !== undefined) {
    return { kind: "environment", value: inline };
  }
  if (hasFile && file !== undefined) {
    return { kind: "file", value: readSafePrivateKeyFile(file) };
  }
  if (
    !hasKeychainService ||
    !hasKeychainAccount ||
    keychainService === undefined ||
    keychainAccount === undefined
  ) {
    throw new PrivateKeyProviderError("invalid_keychain_configuration");
  }
  return {
    kind: "keychain",
    value: readMacOsKeychain(keychainService, keychainAccount),
  };
}

export function configuredPrivateKeyProvider(
  environment: NodeJS.ProcessEnv,
): PrivateKeyProviderKind | null {
  const configured = [
    hasNonBlankValue(environment["GRANTTRACE_APP_PRIVATE_KEY"])
      ? "environment"
      : null,
    hasNonBlankValue(environment["GRANTTRACE_APP_PRIVATE_KEY_FILE"])
      ? "file"
      : null,
    !hasNonBlankValue(
      environment["GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE"],
    ) &&
    !hasNonBlankValue(
      environment["GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT"],
    )
      ? null
      : "keychain",
  ].filter((provider) => provider !== null);
  return configured.length === 1
    ? (configured[0] as PrivateKeyProviderKind)
    : null;
}

function hasNonBlankValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function readSafePrivateKeyFile(path: string): string {
  if (!isAbsolute(path)) {
    throw new PrivateKeyProviderError("invalid_file");
  }

  let descriptor: number | null = null;
  try {
    const parentStat = lstatSync(dirname(path));
    const currentUser = process.getuid?.();
    if (
      !parentStat.isDirectory() ||
      parentStat.isSymbolicLink() ||
      (parentStat.mode & 0o777) !== 0o700 ||
      (currentUser !== undefined &&
        parentStat.uid !== currentUser)
    ) {
      throw new PrivateKeyProviderError("unsafe_file_permissions");
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    const fileStat = fstatSync(descriptor);
    if (
      !fileStat.isFile() ||
      (fileStat.mode & 0o777) !== 0o600 ||
      (currentUser !== undefined && fileStat.uid !== currentUser)
    ) {
      throw new PrivateKeyProviderError("unsafe_file_permissions");
    }
    if (fileStat.size < 1 || fileStat.size > MAX_PRIVATE_KEY_BYTES) {
      throw new PrivateKeyProviderError("invalid_file");
    }
    return readFileSync(descriptor, { encoding: "utf8" });
  } catch (error) {
    if (error instanceof PrivateKeyProviderError) {
      throw error;
    }
    throw new PrivateKeyProviderError("invalid_file");
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

function readMacOsKeychain(service: string, account: string): string {
  if (
    process.platform !== "darwin" ||
    !KeychainLabelSchema.safeParse(service).success ||
    !KeychainLabelSchema.safeParse(account).success
  ) {
    throw new PrivateKeyProviderError(
      process.platform === "darwin"
        ? "invalid_keychain_configuration"
        : "unsupported_keychain",
    );
  }

  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", service, "-a", account],
      {
        encoding: "utf8",
        maxBuffer: MAX_PRIVATE_KEY_BYTES,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 10_000,
      },
    ).trim();
  } catch {
    throw new PrivateKeyProviderError("keychain_lookup_failed");
  }
}
