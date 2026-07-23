import { createHash } from "node:crypto";

import { compareAscii } from "../deterministic.js";
import { canonicalDNFKey, canonicalizeDNF } from "../permissions/canonical.js";
import type {
  CanonicalRoute,
  PermissionDNF,
} from "../permissions/types.js";

export type CatalogIdentity = {
  source: string;
  version: string;
  checksum: `sha256:${string}`;
};

export interface PermissionCatalog {
  readonly identity: CatalogIdentity;
  has(route: CanonicalRoute): boolean;
  lookup(route: CanonicalRoute): PermissionDNF | null;
}

type CatalogEntry = {
  method: string;
  template: string;
  alternatives: PermissionDNF;
};

const FIXTURE_ENTRIES: CatalogEntry[] = [
  {
    method: "GET",
    template: "/repos/{owner}/{repo}/contents/{path}",
    alternatives: [[{ permission: "contents", level: "read" }]],
  },
  {
    method: "POST",
    template:
      "/repos/{owner}/{repo}/issues/{issue_number}/comments",
    alternatives: [
      [{ permission: "issues", level: "write" }],
      [{ permission: "pull_requests", level: "write" }],
    ],
  },
];

export class FixturePermissionCatalog implements PermissionCatalog {
  readonly #requirements: ReadonlyMap<string, PermissionDNF>;
  public readonly identity: CatalogIdentity;

  public constructor(entries: CatalogEntry[] = FIXTURE_ENTRIES) {
    const canonicalEntries = entries
      .map((entry) => ({
        method: entry.method.toUpperCase(),
        template: entry.template,
        alternatives: canonicalizeDNF(entry.alternatives),
      }))
      .sort((left, right) => compareAscii(routeKey(left), routeKey(right)));

    this.#requirements = new Map(
      canonicalEntries.map((entry) => [
        routeKey(entry),
        entry.alternatives,
      ]),
    );

    const catalogPayload = canonicalEntries
      .map(
        (entry) =>
          `${entry.method} ${entry.template} ${canonicalDNFKey(entry.alternatives)}`,
      )
      .join("\n");
    const checksum = createHash("sha256")
      .update(catalogPayload, "utf8")
      .digest("hex");

    this.identity = {
      source: "granttrace-fixture",
      version: "2026-03-10.fixture.1",
      checksum: `sha256:${checksum}`,
    };
  }

  public has(route: CanonicalRoute): boolean {
    return this.#requirements.has(routeKey(route));
  }

  public lookup(route: CanonicalRoute): PermissionDNF | null {
    const requirement = this.#requirements.get(routeKey(route));
    return requirement === undefined ? null : canonicalizeDNF(requirement);
  }
}

export const fixtureCatalog = new FixturePermissionCatalog();

function routeKey(route: Pick<CanonicalRoute, "method" | "template">): string {
  return `${route.method.toUpperCase()} ${route.template}`;
}
