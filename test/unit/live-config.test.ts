import { generateKeyPairSync } from "node:crypto";
import { inspect } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

import {
  LiveConfigError,
  LiveFixtureConfig,
} from "../../src/proof/live-config.js";

describe("disposable live fixture configuration", () => {
  let privateKey: string;

  beforeAll(() => {
    privateKey = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
    }).privateKey;
  });

  it("accepts only a confirmed, disposable fixture", () => {
    const config = LiveFixtureConfig.load(validEnvironment(privateKey));

    expect(config.brokerCredentials().appId).toBe("12345");
    expect(config.fixtureCoordinates()).toEqual({
      owner: "fixture-owner",
      repository: "private-granttrace-fixture",
      issueNumber: "73",
    });
  });

  it("refuses a repository that is not unmistakably disposable", () => {
    const environment = validEnvironment(privateKey);
    environment["GRANTTRACE_LIVE_REPOSITORY"] = "production";

    expect(() => LiveFixtureConfig.load(environment)).toThrow(
      LiveConfigError,
    );
  });

  it("requires the exact disposable confirmation", () => {
    const environment = validEnvironment(privateKey);
    environment["GRANTTRACE_LIVE_CONFIRM_DISPOSABLE"] = "yes";

    expect(() => LiveFixtureConfig.load(environment)).toThrow(
      LiveConfigError,
    );
  });

  it("validates a real RSA key without echoing rejected values", () => {
    const environment = validEnvironment(privateKey);
    const keyCanary = "PRIVATE_KEY_REJECTION_CANARY";
    const repositoryCanary = "sensitive-production-repository";
    environment["GRANTTRACE_APP_PRIVATE_KEY"] = keyCanary;
    environment["GRANTTRACE_LIVE_REPOSITORY"] = repositoryCanary;

    let error: unknown;
    try {
      LiveFixtureConfig.load(environment);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(keyCanary);
    expect(String(error)).not.toContain(repositoryCanary);
  });

  it("redacts configuration and the private key during inspection", () => {
    const config = LiveFixtureConfig.load(validEnvironment(privateKey));

    expect(JSON.stringify(config)).toBe('{"configured":true}');
    expect(inspect(config)).toBe(
      "LiveFixtureConfig { configured: true }",
    );
    expect(
      JSON.stringify(config.brokerCredentials().privateKey),
    ).toBe('"[REDACTED]"');
    expect(inspect(config.brokerCredentials().privateKey)).toBe(
      "[REDACTED]",
    );
    expect(JSON.stringify(config)).not.toContain("fixture-owner");
    expect(JSON.stringify(config)).not.toContain(
      "private-granttrace-fixture",
    );
    expect(JSON.stringify(config)).not.toContain(privateKey);
  });
});

function validEnvironment(privateKey: string): NodeJS.ProcessEnv {
  return {
    GRANTTRACE_APP_ID: "12345",
    GRANTTRACE_INSTALLATION_ID: "98765",
    GRANTTRACE_APP_PRIVATE_KEY: privateKey,
    GRANTTRACE_LIVE_OWNER: "fixture-owner",
    GRANTTRACE_LIVE_REPOSITORY:
      "private-granttrace-fixture",
    GRANTTRACE_LIVE_ISSUE_NUMBER: "73",
    GRANTTRACE_LIVE_CONFIRM_DISPOSABLE: "1",
  };
}
