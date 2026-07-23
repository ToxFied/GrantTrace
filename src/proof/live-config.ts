import { createPrivateKey } from "node:crypto";
import { inspect } from "node:util";

import { z } from "zod";

import { SensitiveValue } from "../security/sensitive-value.js";
import {
  resolvePrivateKey,
  type PrivateKeyProviderKind,
} from "../security/private-key-provider.js";

const DecimalIdentifierSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,15}$/u)
  .refine((value) => Number.isSafeInteger(Number(value)));

const OwnerSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u);

const RepositorySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+-granttrace-fixture$/u);

const PrivateKeySchema = z
  .string()
  .min(256)
  .max(32_768)
  .refine(
    (value) =>
      /^-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END (?:RSA )?PRIVATE KEY-----\r?\n?$/u.test(
        value,
      ),
    "invalid private key envelope",
  )
  .refine((value) => {
    try {
      const key = createPrivateKey(value);
      return key.asymmetricKeyType === "rsa";
    } catch {
      return false;
    }
  }, "invalid RSA private key");

const LiveEnvironmentSchema = z.strictObject({
  GRANTTRACE_APP_ID: DecimalIdentifierSchema,
  GRANTTRACE_INSTALLATION_ID: DecimalIdentifierSchema,
  GRANTTRACE_APP_PRIVATE_KEY: PrivateKeySchema,
  GRANTTRACE_LIVE_OWNER: OwnerSchema,
  GRANTTRACE_LIVE_REPOSITORY: RepositorySchema,
  GRANTTRACE_LIVE_ISSUE_NUMBER: DecimalIdentifierSchema,
  GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: z.literal("1"),
});

export type BrokerCredentials = {
  appId: string;
  installationId: string;
  privateKey: SensitiveValue;
};

export type FixtureCoordinates = {
  owner: string;
  repository: string;
  issueNumber: string;
};

export class LiveConfigError extends Error {
  public constructor() {
    super(
      "The disposable live fixture configuration is missing, malformed, or not explicitly confirmed.",
    );
    this.name = "LiveConfigError";
  }
}

export class LiveFixtureConfig {
  readonly #appId: string;
  readonly #installationId: string;
  readonly #privateKey: SensitiveValue;
  readonly #owner: string;
  readonly #repository: string;
  readonly #issueNumber: string;
  readonly #privateKeyProvider: PrivateKeyProviderKind;

  private constructor(
    input: z.infer<typeof LiveEnvironmentSchema>,
    privateKeyProvider: PrivateKeyProviderKind,
  ) {
    this.#appId = input.GRANTTRACE_APP_ID;
    this.#installationId = input.GRANTTRACE_INSTALLATION_ID;
    this.#privateKey = new SensitiveValue(
      input.GRANTTRACE_APP_PRIVATE_KEY,
    );
    this.#owner = input.GRANTTRACE_LIVE_OWNER;
    this.#repository = input.GRANTTRACE_LIVE_REPOSITORY;
    this.#issueNumber = input.GRANTTRACE_LIVE_ISSUE_NUMBER;
    this.#privateKeyProvider = privateKeyProvider;
  }

  public static load(environment: NodeJS.ProcessEnv): LiveFixtureConfig {
    let privateKey: ReturnType<typeof resolvePrivateKey>;
    try {
      privateKey = resolvePrivateKey(environment);
    } catch {
      throw new LiveConfigError();
    }
    const parsed = LiveEnvironmentSchema.safeParse({
      GRANTTRACE_APP_ID: environment["GRANTTRACE_APP_ID"],
      GRANTTRACE_INSTALLATION_ID:
        environment["GRANTTRACE_INSTALLATION_ID"],
      GRANTTRACE_APP_PRIVATE_KEY: privateKey.value,
      GRANTTRACE_LIVE_OWNER: environment["GRANTTRACE_LIVE_OWNER"],
      GRANTTRACE_LIVE_REPOSITORY:
        environment["GRANTTRACE_LIVE_REPOSITORY"],
      GRANTTRACE_LIVE_ISSUE_NUMBER:
        environment["GRANTTRACE_LIVE_ISSUE_NUMBER"],
      GRANTTRACE_LIVE_CONFIRM_DISPOSABLE:
        environment["GRANTTRACE_LIVE_CONFIRM_DISPOSABLE"],
    });

    if (!parsed.success) {
      throw new LiveConfigError();
    }
    return new LiveFixtureConfig(parsed.data, privateKey.kind);
  }

  public brokerCredentials(): BrokerCredentials {
    return {
      appId: this.#appId,
      installationId: this.#installationId,
      privateKey: this.#privateKey,
    };
  }

  public fixtureCoordinates(): FixtureCoordinates {
    return {
      owner: this.#owner,
      repository: this.#repository,
      issueNumber: this.#issueNumber,
    };
  }

  public toJSON(): { configured: true } {
    return { configured: true };
  }

  public privateKeyProvider(): PrivateKeyProviderKind {
    return this.#privateKeyProvider;
  }

  public [inspect.custom](): string {
    return "LiveFixtureConfig { configured: true }";
  }
}
