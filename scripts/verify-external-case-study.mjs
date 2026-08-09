import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { projectRoot } from "./lib/project.mjs";

const manifestPath = join(
  projectRoot,
  "case-studies",
  "all-contributors-app",
  "case-study.json",
);
const maximumManifestBytes = 256 * 1024;
const maximumSourceBytes = 512 * 1024;
const maximumSourceFiles = 32;
const maximumTotalSourceBytes = 4 * 1024 * 1024;
const maximumScenarios = 16;
const maximumRoutes = 64;
const repository = "https://github.com/all-contributors/app";
const rawSourceBase =
  "https://raw.githubusercontent.com/all-contributors/app/";

let manifest;
try {
  manifest = JSON.parse(
    await readBoundedTextFile(manifestPath, maximumManifestBytes),
  );
} catch {
  throw new Error("The external case-study manifest is invalid.");
}

if (
  manifest?.schemaVersion !== 1 ||
  manifest?.fixtureKind !== "source-derived-replay" ||
  manifest?.upstream?.name !== "All Contributors Bot" ||
  manifest?.upstream?.repository !== repository ||
  !/^[a-f0-9]{40}$/u.test(manifest?.upstream?.commit ?? "") ||
  manifest?.upstream?.commitUrl !==
    `${repository}/commit/${manifest?.upstream?.commit ?? ""}` ||
  manifest?.upstream?.license !== "MIT" ||
  !Array.isArray(manifest?.upstream?.files) ||
  manifest.upstream.files.length === 0 ||
  manifest.upstream.files.length > maximumSourceFiles ||
  !Array.isArray(manifest?.scenarios) ||
  manifest.scenarios.length === 0 ||
  manifest.scenarios.length > maximumScenarios ||
  manifest.scenarios.some(
    (scenario) =>
      !Array.isArray(scenario?.routes) ||
      scenario.routes.length === 0 ||
      scenario.routes.length > maximumRoutes,
  ) ||
  manifest.scenarios.reduce(
    (count, scenario) => count + scenario.routes.length,
    0,
  ) > maximumRoutes
) {
  throw new Error("The external case-study manifest is invalid.");
}

const commit = manifest.upstream.commit;
const paths = new Set();
const sourceContents = new Map();
let totalSourceBytes = 0;
const verifierSignal = AbortSignal.timeout(60_000);
for (const file of manifest.upstream.files) {
  if (
    typeof file?.path !== "string" ||
    Buffer.byteLength(file.path, "utf8") > 200 ||
    !/^(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/u.test(file.path) ||
    file.path.split("/").some((segment) => segment === "." || segment === "..") ||
    paths.has(file.path) ||
    !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? "")
  ) {
    throw new Error("The external case-study source inventory is invalid.");
  }
  paths.add(file.path);

  const url = new URL(
    `${commit}/${file.path}`,
    rawSourceBase,
  );
  let response;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: verifierSignal,
    });
  } catch {
    throw new Error(`Could not retrieve pinned upstream file ${file.path}.`);
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new Error(`Could not retrieve pinned upstream file ${file.path}.`);
  }

  const declaredLengthValue = response.headers.get("content-length");
  const declaredLength =
    declaredLengthValue === null ? null : Number(declaredLengthValue);
  if (Number.isFinite(declaredLength) && declaredLength > maximumSourceBytes) {
    await response.body.cancel();
    throw new Error(`Pinned upstream file ${file.path} exceeds the size limit.`);
  }
  const result = await hashBoundedResponse(response, file.path);
  totalSourceBytes += result.bytes;
  if (result.checksum !== file.sha256) {
    throw new Error(`Pinned upstream file ${file.path} changed unexpectedly.`);
  }
  sourceContents.set(file.path, result.content);
}

validateRouteSources(manifest.scenarios, commit, paths, sourceContents);

console.log(
  `Offline compatibility-study provenance verified: ${manifest.upstream.files.length} files and all route source ranges at ${commit}.`,
);

async function readBoundedTextFile(path, maximumBytes) {
  const handle = await open(path, "r");
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > maximumBytes) {
      throw new Error("File is not a bounded regular file.");
    }

    const content = Buffer.alloc(maximumBytes + 1);
    let total = 0;
    while (total < content.byteLength) {
      const { bytesRead } = await handle.read(
        content,
        total,
        content.byteLength - total,
        null,
      );
      if (bytesRead === 0) {
        break;
      }
      total += bytesRead;
    }
    if (total > maximumBytes) {
      throw new Error("File exceeds the size limit.");
    }
    return content.subarray(0, total).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function hashBoundedResponse(response, path) {
  const reader = response.body.getReader();
  const hash = createHash("sha256");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytes += chunk.value.byteLength;
      if (
        bytes > maximumSourceBytes ||
        totalSourceBytes + bytes > maximumTotalSourceBytes
      ) {
        await reader.cancel();
        throw new Error(`Pinned upstream file ${path} exceeds the size limit.`);
      }
      hash.update(chunk.value);
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return {
    bytes,
    checksum: hash.digest("hex"),
    content: Buffer.concat(chunks, bytes).toString("utf8"),
  };
}

function validateRouteSources(scenarios, commit, paths, sourceContents) {
  const sourcePrefix = `/all-contributors/app/blob/${commit}/`;
  for (const scenario of scenarios) {
    for (const route of scenario.routes) {
      if (
        typeof route?.sourceCall !== "string" ||
        route.sourceCall.length > 100 ||
        !/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/u.test(
          route.sourceCall,
        ) ||
        typeof route?.sourceUrl !== "string" ||
        Buffer.byteLength(route.sourceUrl, "utf8") > 500
      ) {
        throw new Error("The external case-study route provenance is invalid.");
      }

      let sourceUrl;
      try {
        sourceUrl = new URL(route.sourceUrl);
      } catch {
        throw new Error("The external case-study route provenance is invalid.");
      }
      const lineMatch = /^#L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/u.exec(
        sourceUrl.hash,
      );
      if (
        sourceUrl.origin !== "https://github.com" ||
        sourceUrl.username !== "" ||
        sourceUrl.password !== "" ||
        sourceUrl.search !== "" ||
        !sourceUrl.pathname.startsWith(sourcePrefix) ||
        lineMatch === null
      ) {
        throw new Error("The external case-study route provenance is invalid.");
      }

      const sourcePath = sourceUrl.pathname.slice(sourcePrefix.length);
      const source = sourceContents.get(sourcePath);
      if (!paths.has(sourcePath) || typeof source !== "string") {
        throw new Error("A route source URL does not name a hashed pinned file.");
      }
      const startLine = Number(lineMatch[1]);
      const endLine = Number(lineMatch[2] ?? lineMatch[1]);
      const lines = source.split(/\r?\n/u);
      if (
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(endLine) ||
        endLine < startLine ||
        endLine - startLine > 200 ||
        endLine > lines.length
      ) {
        throw new Error("A route source URL has an invalid pinned line range.");
      }
      const rangeText = lines.slice(startLine - 1, endLine).join("\n");
      if (!rangeText.includes(route.sourceCall)) {
        throw new Error(
          `Pinned source range for ${route.sourceCall} does not contain the declared call.`,
        );
      }
    }
  }
}
