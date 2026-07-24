import { stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && args[0] !== "--urls")
) {
  throw new Error("Usage: pnpm catalog:review [--urls]");
}

const sourcePath = join(projectRoot, "src", "evidence", "catalog.ts");
const builtPath = join(projectRoot, "dist", "evidence", "catalog.js");
let sourceDetails;
let builtDetails;
try {
  [sourceDetails, builtDetails] = await Promise.all([
    stat(sourcePath),
    stat(builtPath),
  ]);
} catch {
  throw new Error(
    "The catalog is not built. Run `pnpm build`, then retry the review.",
  );
}
if (sourceDetails.mtimeMs > builtDetails.mtimeMs + 1_000) {
  throw new Error(
    "The built catalog is stale. Run `pnpm build`, then retry the review.",
  );
}

const catalogModule = await import(
  `${pathToFileURL(builtPath).href}?review=${String(builtDetails.mtimeMs)}`
);
const entries = catalogModule.GITHUB_REST_CATALOG_ENTRIES;
const catalog = catalogModule.githubPermissionCatalog;
if (!Array.isArray(entries) || entries.length < 25) {
  throw new Error(
    "The catalog must contain at least 25 reviewed official-documentation entries.",
  );
}
if (
  catalog?.identity?.source !== "github-docs" ||
  typeof catalog.identity.version !== "string" ||
  !catalog.identity.version.startsWith("2026-03-10.") ||
  !/^sha256:[a-f0-9]{64}$/u.test(catalog.identity.checksum)
) {
  throw new Error("The built catalog has invalid pinned provenance.");
}

const routeKeys = new Set();
const documentationUrls = new Set();
for (const entry of entries) {
  validateEntry(entry);
  const routeKey = `${entry.method} ${entry.template}`;
  if (routeKeys.has(routeKey)) {
    throw new Error("The catalog contains a duplicate method/template.");
  }
  routeKeys.add(routeKey);
  documentationUrls.add(entry.documentation);

  const runtimeRequirement = catalog.lookup({
    method: entry.method,
    template: entry.template,
  });
  if (runtimeRequirement === null) {
    throw new Error("A reviewed entry is absent from the runtime catalog.");
  }
}

console.log(
  `Catalog manifest passed offline validation: ${String(
    entries.length,
  )} routes, ${String(documentationUrls.size)} official references.`,
);
console.log(`Catalog identity: ${catalog.identity.version} ${catalog.identity.checksum}`);
console.log("");
console.log("Manual evidence review is still required before catalog changes:");
console.log("  1. Open each pinned docs.github.com URL against API 2026-03-10.");
console.log("  2. Confirm the exact REST method, route template, permission level,");
console.log("     and every documented AND/OR alternative.");
console.log("  3. Exclude conditional or ambiguous routes; never infer missing evidence.");
console.log("  4. Rebuild, run pnpm verify, and review the checksum change.");
console.log("");
console.log(
  "This command validates the curated manifest; it does not fetch or certify current GitHub documentation.",
);

if (args[0] === "--urls") {
  console.log("");
  for (const url of [...documentationUrls].sort(compareAscii)) {
    console.log(url);
  }
}

function validateEntry(entry) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    !["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"].includes(entry.method) ||
    typeof entry.template !== "string" ||
    !/^\/repos\/\{owner\}\/\{repo\}(?:\/[A-Za-z0-9._-]+|\/\{[a-z][a-z0-9_]*\})*$/u.test(
      entry.template,
    ) ||
    !Array.isArray(entry.alternatives) ||
    entry.alternatives.length === 0
  ) {
    throw new Error("The catalog contains a malformed route entry.");
  }

  const alternatives = new Set();
  for (const conjunction of entry.alternatives) {
    if (!Array.isArray(conjunction) || conjunction.length === 0) {
      throw new Error("The catalog contains an empty permission alternative.");
    }
    const terms = new Set();
    for (const term of conjunction) {
      if (
        term === null ||
        typeof term !== "object" ||
        typeof term.permission !== "string" ||
        !/^[a-z][a-z0-9_]{0,63}$/u.test(term.permission) ||
        !["read", "write"].includes(term.level)
      ) {
        throw new Error("The catalog contains a malformed permission term.");
      }
      const termKey = `${term.permission}:${term.level}`;
      if (terms.has(termKey)) {
        throw new Error("The catalog contains a duplicate permission term.");
      }
      terms.add(termKey);
    }
    const alternativeKey = [...terms].sort(compareAscii).join("&");
    if (alternatives.has(alternativeKey)) {
      throw new Error("The catalog contains a duplicate permission alternative.");
    }
    alternatives.add(alternativeKey);
  }

  let documentation;
  try {
    documentation = new URL(entry.documentation);
  } catch {
    throw new Error("The catalog contains an invalid documentation URL.");
  }
  if (
    documentation.protocol !== "https:" ||
    documentation.hostname !== "docs.github.com" ||
    documentation.username !== "" ||
    documentation.password !== "" ||
    documentation.port !== "" ||
    !documentation.pathname.startsWith("/en/rest/") ||
    documentation.search !== "?apiVersion=2026-03-10" ||
    documentation.hash.length < 2
  ) {
    throw new Error(
      "Catalog evidence must be a pinned official docs.github.com REST URL.",
    );
  }
}

function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
