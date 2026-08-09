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
  manifest.upstream.files.length > maximumSourceFiles
) {
  throw new Error("The external case-study manifest is invalid.");
}

const commit = manifest.upstream.commit;
const paths = new Set();
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
  const checksum = result.checksum;
  if (checksum !== file.sha256) {
    throw new Error(`Pinned upstream file ${file.path} changed unexpectedly.`);
  }
}

console.log(
  `External case-study source verified: ${manifest.upstream.files.length} files at ${commit}.`,
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
    }
  } finally {
    reader.releaseLock();
  }
  return { bytes, checksum: hash.digest("hex") };
}
