import { z } from "zod";

export const ProofFailureSchema = z.enum([
  "unknown_route",
  "unsupported_api",
  "missing_permission_evidence",
  "malformed_permission_evidence",
  "evidence_contradiction",
  "authentication_failure",
  "authorization_failure",
  "resource_not_found_or_hidden",
  "rate_limited",
  "github_unavailable",
  "token_expired",
  "instrumentation_failure",
  "test_failure",
  "test_flake_or_indeterminate",
  "cleanup_failure",
  "invalid_token_response",
  "missing_effective_permissions",
  "effective_permission_mismatch",
  "unverified_repository_scope",
  "configuration_failure",
  "contract_mismatch",
]);

export type ProofFailure = z.infer<typeof ProofFailureSchema>;

const NETWORK_FAILURE_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function classifyGitHubFailure(
  error: unknown,
  options: {
    tokenExpiresAt?: Date;
    now?: Date;
  } = {},
): ProofFailure {
  const now = options.now ?? new Date();
  const status = readNumber(error, "status");
  const response = readRecord(error, "response");
  const responseStatus =
    response === null ? null : readNumber(response, "status");
  const effectiveStatus = status ?? responseStatus;
  const headers =
    response === null ? null : readRecord(response, "headers");

  const tokenIsExpired =
    options.tokenExpiresAt !== undefined &&
    options.tokenExpiresAt.getTime() <= now.getTime();

  if (
    tokenIsExpired &&
    (effectiveStatus === null ||
      effectiveStatus === 401 ||
      effectiveStatus === 403)
  ) {
    return "token_expired";
  }

  if (effectiveStatus === 401) {
    return "authentication_failure";
  }

  if (effectiveStatus === 403 || effectiveStatus === 429) {
    if (
      effectiveStatus === 429 ||
      readHeader(headers, "retry-after") !== null ||
      readHeader(headers, "x-ratelimit-remaining") === "0"
    ) {
      return "rate_limited";
    }
    return "authorization_failure";
  }

  if (effectiveStatus === 404) {
    return "resource_not_found_or_hidden";
  }

  if (
    effectiveStatus !== null &&
    effectiveStatus >= 500 &&
    effectiveStatus <= 599
  ) {
    return "github_unavailable";
  }

  const code = readString(error, "code");
  if (code !== null && NETWORK_FAILURE_CODES.has(code)) {
    return "github_unavailable";
  }

  return "test_flake_or_indeterminate";
}

function readRecord(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const nested = (value as Record<string, unknown>)[key];
    return typeof nested === "object" && nested !== null
      ? (nested as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readNumber(value: unknown, key: string): number | null {
  try {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const nested = (value as Record<string, unknown>)[key];
    return typeof nested === "number" && Number.isInteger(nested)
      ? nested
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown, key: string): string | null {
  try {
    if (typeof value !== "object" || value === null) {
      return null;
    }
    const nested = (value as Record<string, unknown>)[key];
    return typeof nested === "string" ? nested : null;
  } catch {
    return null;
  }
}

function readHeader(
  headers: Record<string, unknown> | null,
  name: string,
): string | null {
  if (headers === null) {
    return null;
  }
  try {
    const value = headers[name];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
