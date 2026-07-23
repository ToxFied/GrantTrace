import type { PermissionCatalog } from "../evidence/catalog.js";
import type { CanonicalRoute } from "../permissions/types.js";

const SUPPORTED_METHODS = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "PATCH",
  "POST",
  "PUT",
]);

export type RouteResolution =
  | {
      kind: "resolved";
      route: CanonicalRoute;
    }
  | {
      kind: "unresolved";
      method: string;
      reason: "unsupported_api" | "unresolved_route";
    };

export function safeMethod(method: unknown): string {
  if (typeof method !== "string") {
    return "UNKNOWN";
  }

  const normalized = method.toUpperCase();
  return SUPPORTED_METHODS.has(normalized) ? normalized : "UNKNOWN";
}

export function resolveSafeRoute(
  methodInput: unknown,
  urlInput: unknown,
  catalog: PermissionCatalog,
): RouteResolution {
  const method = safeMethod(methodInput);
  if (method === "UNKNOWN" || typeof urlInput !== "string") {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  if (urlInput === "/graphql" || urlInput.endsWith("/graphql")) {
    return { kind: "unresolved", method, reason: "unsupported_api" };
  }

  if (!isSyntacticallySafeTemplate(urlInput)) {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  const route = { method, template: urlInput };
  if (!catalog.has(route)) {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  return { kind: "resolved", route };
}

export function isSyntacticallySafeTemplate(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 256 ||
    !value.startsWith("/") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\") ||
    value.includes("//") ||
    value.includes("..") ||
    !value.includes("{")
  ) {
    return false;
  }

  const segments = value.slice(1).split("/");
  return segments.every(
    (segment) =>
      /^[a-zA-Z][a-zA-Z0-9._~-]*$/u.test(segment) ||
      /^\{[a-z][a-z0-9_]*\}$/u.test(segment),
  );
}
