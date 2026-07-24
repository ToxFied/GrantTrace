import {
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  createAppJwt,
  mintRestrictedInstallationToken,
  type InstallationTokenRequest,
  type InstallationTokenTransport,
} from "../../src/proof/token-broker.js";
import { LiveFixtureConfig } from "../../src/proof/live-config.js";
import { SensitiveValue } from "../../src/security/sensitive-value.js";

const now = new Date("2026-07-23T12:00:00.000Z");

describe("installation-token broker boundary", () => {
  let privateKey: string;
  let publicKey: string;

  beforeAll(() => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2_048,
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
      publicKeyEncoding: {
        type: "spki",
        format: "pem",
      },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  it("creates an RS256 App JWT with bounded timestamps", () => {
    const jwt = createAppJwt(
      "12345",
      new SensitiveValue(privateKey),
      now,
    ).reveal();
    const [headerPart, payloadPart, signaturePart] = jwt.split(".");
    expect(JSON.parse(decode(headerPart))).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    const nowSeconds = Math.floor(now.getTime() / 1_000);
    expect(JSON.parse(decode(payloadPart))).toEqual({
      iat: nowSeconds - 60,
      exp: nowSeconds + 9 * 60,
      iss: "12345",
    });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`, "utf8");
    verifier.end();
    expect(
      verifier.verify(
        createPublicKey(publicKey),
        Buffer.from(signaturePart ?? "", "base64url"),
      ),
    ).toBe(true);
  });

  it("passes only a JWT and narrowed request to an injectable transport", async () => {
    const config = LiveFixtureConfig.load(environment(privateKey));
    const captured: InstallationTokenRequest[] = [];
    const transport: InstallationTokenTransport = {
      async createInstallationToken(request) {
        captured.push(request);
        return {
          token: "ghs_RESTRICTED_TOKEN_CANARY",
          expires_at: "2026-07-23T13:00:00.000Z",
          permissions: { issues: "write", metadata: "read" },
          repositories: [
            {
              full_name:
                "fixture-owner/private-granttrace-fixture",
            },
          ],
        };
      },
    };

    const result = await mintRestrictedInstallationToken(
      config,
      { issues: "write" },
      { transport, now },
    );

    const request = captured[0];
    expect(request).toBeDefined();
    if (request === undefined) {
      throw new Error("The token transport was not called.");
    }
    expect(request.installationId).toBe("98765");
    expect(request.permissions).toEqual({ issues: "write" });
    expect(request.repository).toBe(
      "private-granttrace-fixture",
    );
    expect(request.authorization.reveal().split(".")).toHaveLength(3);
    expect(JSON.stringify(request)).not.toContain(privateKey);
    expect(JSON.stringify(result)).not.toContain(
      "ghs_RESTRICTED_TOKEN_CANARY",
    );
    expect(result.requestedPermissions).toEqual({ issues: "write" });
    expect(result.mandatoryPermissions).toEqual({ metadata: "read" });
  });

});

function decode(value: string | undefined): string {
  return Buffer.from(value ?? "", "base64url").toString("utf8");
}

function environment(privateKey: string): NodeJS.ProcessEnv {
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
