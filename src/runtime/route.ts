import {
  GITHUB_REST_CATALOG_ENTRIES,
  type CatalogEntry,
} from "../evidence/catalog.js";
import type { CanonicalRoute } from "../permissions/types.js";
import { safeMethod, type RouteResolution } from "../routes/canonical.js";

export type RuntimeRouteResolution =
  | RouteResolution
  | {
      kind: "ignored";
    };

type RouteCandidate = {
  route: CanonicalRoute;
  literalSegments: number;
  pathParameters: number;
};

const GITHUB_REST_ORIGIN = "https://api.github.com";

export function resolveRuntimeRoute(
  methodInput: unknown,
  urlInput: unknown,
  entries: readonly Pick<CatalogEntry, "method" | "template">[] =
    GITHUB_REST_CATALOG_ENTRIES,
): RuntimeRouteResolution {
  const url = parseRequestUrl(urlInput);
  if (url === null || url.origin !== GITHUB_REST_ORIGIN) {
    return { kind: "ignored" };
  }

  return resolveParsedRoute(methodInput, url, entries);
}

export function resolvePermissionBearingRoute(
  methodInput: unknown,
  urlInput: unknown,
  entries: readonly Pick<CatalogEntry, "method" | "template">[] =
    GITHUB_REST_CATALOG_ENTRIES,
): RouteResolution | null {
  const url = parseRequestUrl(urlInput);
  if (
    url === null ||
    (url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    return null;
  }
  if (url.pathname.startsWith("/api/v3/")) {
    url.pathname = url.pathname.slice("/api/v3".length);
  }
  return resolveParsedRoute(methodInput, url, entries);
}

function resolveParsedRoute(
  methodInput: unknown,
  url: URL,
  entries: readonly Pick<CatalogEntry, "method" | "template">[],
): RouteResolution {
  const method = safeMethod(methodInput);
  if (method === "UNKNOWN") {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }
  if (url.pathname === "/graphql" || url.pathname.endsWith("/graphql")) {
    return { kind: "unresolved", method, reason: "unsupported_api" };
  }

  const candidates = entries.flatMap((entry) => {
    if (entry.method.toUpperCase() !== method) {
      return [];
    }
    const specificity = matchTemplate(entry.template, url.pathname);
    if (specificity === null) {
      return [];
    }
    return [{
      route: { method, template: entry.template },
      ...specificity,
    }];
  });
  if (candidates.length === 0) {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  candidates.sort(compareSpecificity);
  const best = candidates[0]!;
  const equallySpecific = candidates.filter(
    (candidate) => compareSpecificity(candidate, best) === 0,
  );
  if (equallySpecific.length !== 1) {
    return { kind: "unresolved", method, reason: "unresolved_route" };
  }

  return { kind: "resolved", route: best.route };
}

function parseRequestUrl(input: unknown): URL | null {
  let value: string;
  if (typeof input === "string") {
    value = input;
  } else if (input instanceof URL) {
    value = input.href;
  } else if (
    typeof Request !== "undefined" &&
    input instanceof Request
  ) {
    value = input.url;
  } else {
    return null;
  }

  if (value.length > 8_192) {
    return null;
  }
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function matchTemplate(
  template: string,
  concretePath: string,
): Pick<RouteCandidate, "literalSegments" | "pathParameters"> | null {
  if (
    concretePath.length === 0 ||
    concretePath.length > 4_096 ||
    concretePath.includes("\\")
  ) {
    return null;
  }
  const templateSegments = segments(template);
  const concreteSegments = segments(concretePath);
  let concreteIndex = 0;
  let literalSegments = 0;
  let pathParameters = 0;

  for (const [templateIndex, templateSegment] of templateSegments.entries()) {
    if (templateSegment === "{path}") {
      if (
        templateIndex !== templateSegments.length - 1 ||
        concreteIndex >= concreteSegments.length
      ) {
        return null;
      }
      pathParameters += 1;
      concreteIndex = concreteSegments.length;
      continue;
    }

    const concreteSegment = concreteSegments[concreteIndex];
    if (concreteSegment === undefined || concreteSegment.length === 0) {
      return null;
    }
    if (isParameter(templateSegment)) {
      concreteIndex += 1;
      continue;
    }
    if (templateSegment !== concreteSegment) {
      return null;
    }
    literalSegments += 1;
    concreteIndex += 1;
  }

  return concreteIndex === concreteSegments.length
    ? { literalSegments, pathParameters }
    : null;
}

function segments(path: string): string[] {
  return path.startsWith("/") ? path.slice(1).split("/") : [];
}

function isParameter(segment: string): boolean {
  return /^\{[a-z][a-z0-9_]*\}$/u.test(segment);
}

function compareSpecificity(
  left: RouteCandidate,
  right: RouteCandidate,
): number {
  if (left.literalSegments !== right.literalSegments) {
    return right.literalSegments - left.literalSegments;
  }
  if (left.pathParameters !== right.pathParameters) {
    return left.pathParameters - right.pathParameters;
  }
  return 0;
}
