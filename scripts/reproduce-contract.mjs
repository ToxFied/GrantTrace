import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  portableTemporaryAcceptanceEnvironment,
  run,
} from "./lib/process.mjs";
import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const cliPath = join(projectRoot, "dist", "cli", "bin.js");
const fixturePath = join(
  projectRoot,
  "test",
  "fixtures",
  "observations",
  "triage.ndjson",
);
const goldenPath = join(
  projectRoot,
  "test",
  "golden",
  "triage-contract.json",
);
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "granttrace-reproduction-"),
);

try {
  const first = await reproduce(join(temporaryRoot, "first"));
  const second = await reproduce(join(temporaryRoot, "second"));
  const golden = await readFile(goldenPath);

  if (!first.equals(second)) {
    throw new Error(
      "Contract reproduction is nondeterministic: repeated outputs differ.",
    );
  }
  if (!first.equals(golden)) {
    throw new Error(
      "The reproduced fixture contract differs from test/golden/triage-contract.json. Review and update the golden contract intentionally.",
    );
  }

  const hash = createHash("sha256").update(first).digest("hex");
  console.log(`Contract reproduction passed (sha256:${hash}).`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function reproduce(directory) {
  const observationsDirectory = join(
    directory,
    ".granttrace",
    "observations",
  );
  await mkdir(observationsDirectory, { recursive: true, mode: 0o700 });
  await chmod(join(directory, ".granttrace"), 0o700);
  await chmod(observationsDirectory, 0o700);

  const copiedFixture = join(observationsDirectory, "triage-integration.ndjson");
  await copyFile(fixturePath, copiedFixture);
  await chmod(copiedFixture, 0o600);

  await run(
    process.execPath,
    [cliPath, "check", "--accept"],
    {
      cwd: directory,
      environment: portableTemporaryAcceptanceEnvironment(),
    },
  );

  return readFile(join(directory, "granttrace.lock.json"));
}
