import { ZodError } from "zod";

import { canonicalizeDNF, PermissionModelError } from "./canonical.js";
import { PermissionTermSchema } from "./schema.js";
import type { PermissionDNF } from "./types.js";

export type PermissionEvidenceErrorCode =
  | "empty_header"
  | "empty_alternative"
  | "empty_term"
  | "malformed_term"
  | "invalid_permission"
  | "unsupported_level"
  | "conflicting_duplicate";

export class PermissionEvidenceError extends Error {
  public readonly code: PermissionEvidenceErrorCode;

  public constructor(code: PermissionEvidenceErrorCode) {
    super(`Malformed GitHub permission evidence (${code}).`);
    this.name = "PermissionEvidenceError";
    this.code = code;
  }
}

export function parseAcceptedPermissionsHeader(value: string): PermissionDNF {
  if (value.trim().length === 0) {
    throw new PermissionEvidenceError("empty_header");
  }

  const rawAlternatives = value.split(";");
  if (rawAlternatives.some((alternative) => alternative.trim().length === 0)) {
    throw new PermissionEvidenceError("empty_alternative");
  }

  const alternatives = rawAlternatives.map((rawAlternative) => {
    const rawTerms = rawAlternative.split(",");
    if (rawTerms.some((term) => term.trim().length === 0)) {
      throw new PermissionEvidenceError("empty_term");
    }

    return rawTerms.map((rawTerm) => parseTerm(rawTerm));
  });

  try {
    return canonicalizeDNF(alternatives);
  } catch (error) {
    if (error instanceof PermissionModelError) {
      throw new PermissionEvidenceError("conflicting_duplicate");
    }
    throw error;
  }
}

function parseTerm(rawTerm: string) {
  const parts = rawTerm.split("=");
  if (parts.length !== 2) {
    throw new PermissionEvidenceError("malformed_term");
  }

  const permission = parts[0]?.trim() ?? "";
  const level = parts[1]?.trim() ?? "";

  try {
    return PermissionTermSchema.parse({ permission, level });
  } catch (error) {
    if (error instanceof ZodError) {
      const levelIssue = error.issues.some((issue) => issue.path[0] === "level");
      throw new PermissionEvidenceError(
        levelIssue ? "unsupported_level" : "invalid_permission",
      );
    }
    throw error;
  }
}
