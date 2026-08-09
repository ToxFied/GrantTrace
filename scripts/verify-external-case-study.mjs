import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { projectRoot } from "./lib/project.mjs";

const manifestPath = join(
  projectRoot,
  "case-studies",
  "all-contributors-app",
  "case-study.json",
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const maximumSourceBytes = 512 * 1024;

if (
  manifest?.schemaVersion !== 1 ||
  manifest?.fixtureKind !== "source-derived-replay" ||
  !/^[a-f0-9]{40}$/u.test(manifest?.upstream?.commit ?? "") ||
  !Array.isArray(manifest?.upstream?.files)
) {
  throw new Error("The external case-study manifest is invalid.");
}

const commit = manifest.upstream.commit;
for (const file of manifest.upstream.files) {
  if (
    typeof file?.path !== "string" ||
    file.path.length === 0 ||
    file.path.includes("..") ||
    !/^[a-f0-9]{64}$/u.test(file?.sha256 ?? "")
  ) {
    throw new Error("The external case-study source inventory is invalid.");
  }

  const url = new URL(
    `${commit}/${file.path}`,
    "https://raw.githubusercontent.com/all-contributors/app/",
  );
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Could not retrieve pinned upstream file ${file.path}.`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumSourceBytes) {
    throw new Error(`Pinned upstream file ${file.path} exceeds the size limit.`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  if (content.byteLength > maximumSourceBytes) {
    throw new Error(`Pinned upstream file ${file.path} exceeds the size limit.`);
  }
  const checksum = createHash("sha256").update(content).digest("hex");
  if (checksum !== file.sha256) {
    throw new Error(`Pinned upstream file ${file.path} changed unexpectedly.`);
  }
}

console.log(
  `External case-study source verified: ${manifest.upstream.files.length} files at ${commit}.`,
);
