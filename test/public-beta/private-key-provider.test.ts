import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configuredPrivateKeyProvider,
  PrivateKeyProviderError,
  resolvePrivateKey,
} from "../../src/security/private-key-provider.js";

describe("private-key providers", () => {
  let root: string;
  let keyDirectory: string;
  let keyPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "granttrace-key-provider-"));
    keyDirectory = join(root, "keys");
    keyPath = join(keyDirectory, "fixture.private-key.pem");
    await mkdir(keyDirectory, { mode: 0o700 });
    await writeFile(keyPath, "PRIVATE_KEY_FILE_CANARY", {
      encoding: "utf8",
      mode: 0o600,
    });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads an absolute 0600 file from an owned 0700 directory", () => {
    const result = resolvePrivateKey({
      GRANTTRACE_APP_PRIVATE_KEY_FILE: keyPath,
    });

    expect(result).toEqual({
      kind: "file",
      value: "PRIVATE_KEY_FILE_CANARY",
    });
    expect(
      configuredPrivateKeyProvider({
        GRANTTRACE_APP_PRIVATE_KEY_FILE: keyPath,
      }),
    ).toBe("file");
  });

  it("rejects relative paths and permissive file or directory modes", async () => {
    expectProviderError(
      () =>
        resolvePrivateKey({
          GRANTTRACE_APP_PRIVATE_KEY_FILE: "relative-key.pem",
        }),
      "invalid_file",
    );

    if (process.platform !== "win32") {
      await chmod(keyPath, 0o640);
      expectProviderError(
        () =>
          resolvePrivateKey({
            GRANTTRACE_APP_PRIVATE_KEY_FILE: keyPath,
          }),
        "unsafe_file_permissions",
      );

      await chmod(keyPath, 0o600);
      await chmod(keyDirectory, 0o750);
      expectProviderError(
        () =>
          resolvePrivateKey({
            GRANTTRACE_APP_PRIVATE_KEY_FILE: keyPath,
          }),
        "unsafe_file_permissions",
      );
    }
  });

  it.skipIf(process.platform === "win32")(
    "does not follow a private-key symlink",
    async () => {
      const linkPath = join(keyDirectory, "linked.private-key.pem");
      await symlink(keyPath, linkPath);

      expectProviderError(
        () =>
          resolvePrivateKey({
            GRANTTRACE_APP_PRIVATE_KEY_FILE: linkPath,
          }),
        "invalid_file",
      );
    },
  );

  it("rejects provider conflicts before reading any value", () => {
    const environment = {
      GRANTTRACE_APP_PRIVATE_KEY: "INLINE_PRIVATE_KEY_CANARY",
      GRANTTRACE_APP_PRIVATE_KEY_FILE: keyPath,
    };

    expectProviderError(
      () => resolvePrivateKey(environment),
      "multiple_providers",
    );
    expect(configuredPrivateKeyProvider(environment)).toBeNull();
  });

  it("requires both Keychain labels without invoking Keychain", () => {
    expectProviderError(
      () =>
        resolvePrivateKey({
          GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE: "GrantTrace fixture",
        }),
      "invalid_keychain_configuration",
    );
  });

  it("rejects malformed or unsupported Keychain configuration without a lookup", () => {
    expectProviderError(
      () =>
        resolvePrivateKey({
          GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_SERVICE: "bad;service",
          GRANTTRACE_APP_PRIVATE_KEY_KEYCHAIN_ACCOUNT: "fixture",
        }),
      process.platform === "darwin"
        ? "invalid_keychain_configuration"
        : "unsupported_keychain",
    );
  });
});

function expectProviderError(
  operation: () => unknown,
  code: PrivateKeyProviderError["code"],
): void {
  try {
    operation();
    throw new Error("Expected private-key provider resolution to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateKeyProviderError);
    expect((error as PrivateKeyProviderError).code).toBe(code);
    expect(String(error)).not.toContain("PRIVATE_KEY");
  }
}
