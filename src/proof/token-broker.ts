import { createSign } from "node:crypto";

import { Octokit } from "@octokit/core";

import {
  canonicalizeAssignment,
} from "../permissions/canonical.js";
import { PermissionAssignmentSchema } from "../permissions/schema.js";
import type { PermissionAssignment } from "../permissions/types.js";
import { SensitiveValue } from "../security/sensitive-value.js";
import { classifyGitHubFailure, type ProofFailure } from "./failure.js";
import type { LiveFixtureConfig } from "./live-config.js";
import { MANDATORY_INSTALLATION_PERMISSIONS } from "./permission-baseline.js";
import {
  validateInstallationTokenResponse,
  type ValidatedInstallationToken,
} from "./token-response.js";
import { GITHUB_API_VERSION } from "../version.js";

export type InstallationTokenRequest = {
  authorization: SensitiveValue;
  installationId: string;
  permissions: PermissionAssignment;
  repository: string;
};

export interface InstallationTokenTransport {
  createInstallationToken(
    request: InstallationTokenRequest,
  ): Promise<unknown>;
}

export class TokenBrokerError extends Error {
  public readonly code: ProofFailure;

  public constructor(code: ProofFailure) {
    super(`GitHub installation-token request failed (${code}).`);
    this.name = "TokenBrokerError";
    this.code = code;
  }
}

export async function mintRestrictedInstallationToken(
  config: LiveFixtureConfig,
  requestedPermissionsInput: PermissionAssignment,
  options: {
    transport?: InstallationTokenTransport;
    now?: Date;
  } = {},
): Promise<ValidatedInstallationToken> {
  const now = options.now ?? new Date();
  const permissionsResult = PermissionAssignmentSchema.safeParse(
    requestedPermissionsInput,
  );
  if (!permissionsResult.success) {
    throw new TokenBrokerError("invalid_token_response");
  }
  const permissions = canonicalizeAssignment(permissionsResult.data);
  const credentials = config.brokerCredentials();
  const fixture = config.fixtureCoordinates();
  const authorization = createAppJwt(
    credentials.appId,
    credentials.privateKey,
    now,
  );
  const transport = options.transport ?? new OctokitTokenTransport();

  let raw: unknown;
  try {
    raw = await transport.createInstallationToken({
      authorization,
      installationId: credentials.installationId,
      permissions,
      repository: fixture.repository,
    });
  } catch (error) {
    if (error instanceof TokenBrokerError) {
      throw error;
    }
    throw new TokenBrokerError(classifyGitHubFailure(error));
  }

  return validateInstallationTokenResponse(
    raw,
    {
      requestedPermissions: permissions,
      mandatoryPermissions: MANDATORY_INSTALLATION_PERMISSIONS,
      owner: fixture.owner,
      repository: fixture.repository,
    },
    now,
  );
}

export function createAppJwt(
  appId: string,
  privateKey: SensitiveValue,
  now = new Date(),
): SensitiveValue {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const header = encodeJson({ alg: "RS256", typ: "JWT" });
  const payload = encodeJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: appId,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned, "utf8");
  signer.end();
  const signature = signer
    .sign(privateKey.reveal())
    .toString("base64url");
  return new SensitiveValue(`${unsigned}.${signature}`);
}

export class OctokitTokenTransport implements InstallationTokenTransport {
  public async createInstallationToken(
    request: InstallationTokenRequest,
  ): Promise<unknown> {
    const octokit = new Octokit();
    try {
      const response = await octokit.request(
        "POST /app/installations/{installation_id}/access_tokens",
        {
          installation_id: Number(request.installationId),
          permissions: request.permissions,
          repositories: [request.repository],
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${request.authorization.reveal()}`,
            "x-github-api-version": GITHUB_API_VERSION,
          },
        },
      );
      return response.data;
    } catch (error) {
      throw new TokenBrokerError(classifyGitHubFailure(error));
    }
  }
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
