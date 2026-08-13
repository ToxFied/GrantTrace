import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { parseNpmPackOutput } from "./lib/npm-pack.mjs";
import {
  parsePackageArtifacts,
  resolvePackageArtifact,
} from "./lib/package-artifact.mjs";
import {
  invocationArgs,
  npmInvocation,
} from "./lib/package-manager.mjs";
import { portableEnvironment, run } from "./lib/process.mjs";
import { projectRoot, readPackageManifest } from "./lib/project.mjs";
import { readTarGzip } from "./lib/tar.mjs";

const MAX_SCANNED_FILE_BYTES = 10 * 1024 * 1024;
const secretRules = [
  {
    name: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{64,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  },
  {
    name: "github-token",
    pattern:
      /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/mu,
  },
  {
    name: "npm-token",
    pattern: /(?:^|[^A-Za-z0-9])npm_[A-Za-z0-9]{30,}/mu,
  },
  {
    name: "jwt",
    pattern:
      /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/mu,
  },
  {
    name: "npm-auth-config",
    pattern: /(?:^|\n)\s*(?:\/\/[^:\n]+\/)?:?_authToken\s*=\s*[^\s${][^\r\n]*/mu,
  },
];

await readPackageManifest();
const findings = [];
const canaries = fixtureCanaries();
const suppliedArtifacts = parsePackageArtifacts(process.argv.slice(2));

const tracked = await run("git", ["ls-files", "-z"], {
  cwd: projectRoot,
  environment: portableEnvironment(),
  outputLimit: 10 * 1024 * 1024,
});
const deleted = new Set(
  (
    await run("git", ["ls-files", "--deleted", "-z"], {
      cwd: projectRoot,
      environment: portableEnvironment(),
      outputLimit: 10 * 1024 * 1024,
    })
  ).stdout
    .split("\0")
    .filter(Boolean),
);
for (const relativePath of tracked.stdout.split("\0").filter(Boolean)) {
  if (deleted.has(relativePath)) {
    continue;
  }
  if (isSensitiveRepositoryPath(relativePath)) {
    findings.push({ path: relativePath, rule: "sensitive-path" });
    continue;
  }
  const absolutePath = resolve(projectRoot, relativePath);
  if (!isWithinProject(absolutePath)) {
    findings.push({ path: relativePath, rule: "path-escape" });
    continue;
  }
  await scanContent(relativePath, Buffer.from(relativePath), findings, canaries);
  await scanContent(
    relativePath,
    await readFileBounded(absolutePath),
    findings,
    canaries,
  );
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "granttrace-leakage-"));
try {
  const tarballPaths =
    suppliedArtifacts.length > 0
      ? await Promise.all(
          suppliedArtifacts.map((path) => resolvePackageArtifact(path)),
        )
      : [await createFreshTarball(temporaryRoot)];

  for (const tarballPath of tarballPaths) {
    const archive = await readFileBounded(tarballPath, 25 * 1024 * 1024);
    const entries = readTarGzip(archive);
    for (const entry of entries) {
      if (!entry.path.startsWith("package/")) {
        findings.push({
          path: `${basename(tarballPath)}:<archive-entry>`,
          rule: "path-escape",
        });
        continue;
      }
      const relativePath = entry.path.slice("package/".length);
      const findingPath = `${basename(tarballPath)}:${relativePath}`;
      await scanContent(
        findingPath,
        Buffer.from(relativePath),
        findings,
        canaries,
      );
      if (isSensitivePackagePath(relativePath)) {
        findings.push({
          path: findingPath,
          rule: "package-residue",
        });
        continue;
      }
      await scanContent(
        findingPath,
        entry.content,
        findings,
        canaries,
      );
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (findings.length > 0) {
  const unique = [
    ...new Map(
      findings.map((finding) => [
        `${finding.path}\0${finding.rule}`,
        finding,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.path}\0${left.rule}`.localeCompare(
      `${right.path}\0${right.rule}`,
      "en",
    ),
  );
  console.error("Leakage scan failed. Potential sensitive material:");
  for (const finding of unique) {
    console.error(
      `  ${redactCanaries(finding.path, canaries)} (${finding.rule})`,
    );
  }
  console.error("Matched values are intentionally not printed.");
  process.exitCode = 1;
} else {
  console.log("Leakage scan passed for tracked files and package contents.");
}

async function createFreshTarball(directory) {
  const npm = await npmInvocation();
  const cache = join(directory, "npm-cache");
  const userConfig = join(directory, "empty-npmrc");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await Promise.all([
    mkdir(cache, { recursive: true, mode: 0o700 }),
    writeFile(userConfig, "", { mode: 0o600 }),
  ]);
  const packed = await run(
    npm.command,
    invocationArgs(npm, [
      "pack",
      "--json",
      "--pack-destination",
      directory,
    ]),
    {
      cwd: projectRoot,
      environment: portableEnvironment({
        npm_config_cache: cache,
        npm_config_userconfig: userConfig,
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_update_notifier: "false",
      }),
    },
  );
  const { filename } = parseNpmPackOutput(packed.stdout);
  return join(directory, filename);
}

async function readFileBounded(path, maximum = MAX_SCANNED_FILE_BYTES) {
  const details = await stat(path);
  if (!details.isFile() || details.size > maximum) {
    throw new Error("Leakage scan encountered an unsafe file.");
  }
  return readFile(path);
}

async function scanContent(path, buffer, destination, identityCanaries) {
  if (buffer.length > MAX_SCANNED_FILE_BYTES) {
    destination.push({ path, rule: "oversized-file" });
    return;
  }
  if (buffer.includes(0)) {
    return;
  }
  const content = buffer.toString("utf8");
  for (const rule of secretRules) {
    if (rule.pattern.test(content)) {
      destination.push({ path, rule: rule.name });
    }
  }
  for (const canary of identityCanaries) {
    if (content.includes(canary)) {
      destination.push({ path, rule: "fixture-identity" });
    }
  }
}

function fixtureCanaries() {
  const values = [];
  for (const name of [
    "GRANTTRACE_LIVE_OWNER",
    "GRANTTRACE_LIVE_REPOSITORY",
    "GRANTTRACE_APP_ID",
    "GRANTTRACE_INSTALLATION_ID",
    "GRANTTRACE_LIVE_ISSUE_NUMBER",
  ]) {
    const value = process.env[name]?.trim();
    if (value !== undefined && value.length >= 6) {
      values.push(value);
    }
  }

  const supplied = process.env.GRANTTRACE_LEAKAGE_CANARIES;
  if (supplied !== undefined && supplied.length > 0) {
    let parsed;
    try {
      parsed = JSON.parse(supplied);
    } catch {
      parsed = supplied.split(/\r?\n/u);
    }
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      throw new Error("GRANTTRACE_LEAKAGE_CANARIES must be a JSON string array or newline list.");
    }
    for (const value of parsed) {
      if (value.length >= 4) {
        values.push(value);
      }
    }
  }

  return [...new Set(values)];
}

function isSensitiveRepositoryPath(path) {
  const lower = path.toLowerCase();
  return (
    /(?:^|\/)\.env(?:\.|$)/u.test(lower) && lower !== ".env.example"
  ) || (
    /\.(?:pem|key|p8|p12|tgz)$/u.test(lower) ||
    lower.startsWith(".granttrace/") ||
    lower.includes("/.granttrace/") ||
    /(?:^|\/)(?:report|proof-report)\.json$/u.test(lower)
  );
}

function isSensitivePackagePath(path) {
  const lower = path.toLowerCase();
  return (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("..") ||
    lower.startsWith(".granttrace/") ||
    lower.includes("/.granttrace/") ||
    /(?:^|\/)(?:test|tests|fixtures?|examples?|coverage|node_modules|\.cache)(?:\/|$)/u.test(
      lower,
    ) ||
    /(?:^|\/)\.env(?:\.|$)/u.test(lower) ||
    /\.(?:pem|key|p8|p12|tgz|log)$/u.test(lower) ||
    /(?:^|\/)(?:report|proof-report)\.json$/u.test(lower)
  );
}

function isWithinProject(path) {
  const candidate = relative(projectRoot, path);
  return (
    candidate === "" ||
    (candidate !== ".." &&
      !candidate.startsWith(`..${sep}`) &&
      !isAbsolute(candidate))
  );
}

function redactCanaries(value, identityCanaries) {
  let redacted = value;
  for (const canary of identityCanaries) {
    redacted = redacted.split(canary).join("[redacted]");
  }
  return redacted;
}
