import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseNpmPackOutput } from "./lib/npm-pack.mjs";
import {
  invocationArgs,
  npmInvocation,
  pnpmInvocation,
} from "./lib/package-manager.mjs";
import {
  portableEnvironment,
  portableTemporaryAcceptanceEnvironment,
  run,
} from "./lib/process.mjs";
import { projectRoot, readPackageManifest } from "./lib/project.mjs";
import { readTarGzip } from "./lib/tar.mjs";

const smokeUndiciVersion = "7.16.0";
const manifest = await readPackageManifest();
validateManifest(manifest);

const temporaryRoot = await mkdtemp(join(tmpdir(), "granttrace-package-"));
const packDirectory = join(temporaryRoot, "packed");
const installDirectory = join(temporaryRoot, "consumer");
const pnpmInstallDirectory = join(temporaryRoot, "pnpm-consumer");
const cacheDirectory = join(temporaryRoot, "npm-cache");
const pnpmStoreDirectory = join(temporaryRoot, "pnpm-store");
const userConfigPath = join(temporaryRoot, "empty-npmrc");
const npm = await npmInvocation();
const pnpm = await pnpmInvocation();

try {
  await Promise.all([
    mkdir(packDirectory, { recursive: true, mode: 0o700 }),
    mkdir(installDirectory, { recursive: true, mode: 0o700 }),
    mkdir(pnpmInstallDirectory, { recursive: true, mode: 0o700 }),
    mkdir(cacheDirectory, { recursive: true, mode: 0o700 }),
    mkdir(pnpmStoreDirectory, { recursive: true, mode: 0o700 }),
    writeFile(userConfigPath, "", { mode: 0o600 }),
  ]);

  const environment = portableEnvironment({
    npm_config_cache: cacheDirectory,
    npm_config_userconfig: userConfigPath,
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  });

  const packed = await run(
    npm.command,
    invocationArgs(npm, [
      "pack",
      "--json",
      "--pack-destination",
      packDirectory,
    ]),
    { cwd: projectRoot, environment, expectedExitCodes: [0, 1, 2] },
  );
  assertCommandPassed(packed, "npm could not create the package tarball.");
  const packResult = parseNpmPackOutput(packed.stdout);
  if (!Array.isArray(packResult.files)) {
    throw new Error("npm pack did not return its file manifest.");
  }
  validatePackedFiles(packResult.files);

  const tarballPath = join(packDirectory, packResult.filename);
  const archiveEntries = readTarGzip(await readFile(tarballPath));
  validateArchiveEntries(archiveEntries, packResult.files);

  await writeFile(
    join(installDirectory, "package.json"),
    `${JSON.stringify(
      { name: "granttrace-package-smoke", private: true, type: "module" },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  const installed = await run(
    npm.command,
    invocationArgs(npm, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      tarballPath,
      `@octokit/core@${manifest.dependencies["@octokit/core"]}`,
      `undici@${smokeUndiciVersion}`,
    ]),
    {
      cwd: installDirectory,
      environment,
      expectedExitCodes: [0, 1, 2],
    },
  );
  assertCommandPassed(installed, "npm could not install the package tarball.");

  const installedPackageDirectory = join(
    installDirectory,
    "node_modules",
    ...manifest.name.split("/"),
  );
  const installedManifest = JSON.parse(
    await readFile(join(installedPackageDirectory, "package.json"), "utf8"),
  );
  if (
    installedManifest.name !== manifest.name ||
    installedManifest.version !== manifest.version
  ) {
    throw new Error("The installed package identity differs from the tarball.");
  }

  const installedBin = await validateInstalledBin(installDirectory);
  const help = await runInstalledCli(
    installedBin,
    installedPackageDirectory,
    ["--help"],
    {
      cwd: installDirectory,
      environment,
    },
  );
  if (
    !help.stdout.includes("Core workflow") ||
    !help.stdout.includes("record     Run, observe, review") ||
    !help.stdout.includes("granttrace record <name> -- <test-command>")
  ) {
    throw new Error("The installed CLI help is incomplete.");
  }

  const version = await runInstalledCli(
    installedBin,
    installedPackageDirectory,
    ["--version"],
    {
      cwd: installDirectory,
      environment,
    },
  );
  if (version.stdout.trim() !== manifest.version) {
    throw new Error("The installed CLI reports the wrong version.");
  }

  const imported = await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import('granttrace'); await import('granttrace/octokit'); process.stdout.write('imports-ok')",
    ],
    {
      cwd: installDirectory,
      environment,
      expectedExitCodes: [0, 1],
    },
  );
  assertCommandPassed(imported, "The npm consumer could not import public exports.");
  if (imported.stdout !== "imports-ok") {
    throw new Error("The installed package exports could not be imported.");
  }

  const scenarioPath = join(installDirectory, "offline-scenario.mjs");
  await writeFile(scenarioPath, offlineScenarioSource(), { mode: 0o600 });
  if (
    (await pathExists(join(installDirectory, ".granttrace"))) ||
    (await pathExists(join(installDirectory, ".gitignore")))
  ) {
    throw new Error("The clean npm consumer unexpectedly started initialized.");
  }
  const recorded = await runInstalledCli(
    installedBin,
    installedPackageDirectory,
    [
      "record",
      "package-smoke",
      "--",
      process.execPath,
      scenarioPath,
    ],
    {
      cwd: installDirectory,
      environment,
      expectedExitCodes: [6],
    },
  );
  if (
    !recorded.stdout.includes("GrantTrace initialized") ||
    !recorded.stdout.includes("GrantTrace record complete") ||
    !recorded.stderr.includes("GrantTrace contract review required")
  ) {
    throw new Error(
      "The installed CLI did not initialize, record, and request review.",
    );
  }
  if (
    (await readFile(join(installDirectory, ".gitignore"), "utf8")) !==
    ".granttrace/\n"
  ) {
    throw new Error("The installed CLI did not ignore its private local state.");
  }
  if (await pathExists(join(installDirectory, "granttrace.lock.json"))) {
    throw new Error("The non-interactive recording was accepted without review.");
  }

  await runInstalledCli(
    installedBin,
    installedPackageDirectory,
    ["check", "--accept"],
    {
      cwd: installDirectory,
      environment: portableTemporaryAcceptanceEnvironment(environment),
    },
  );
  const checked = await runInstalledCli(
    installedBin,
    installedPackageDirectory,
    ["check"],
    {
      cwd: installDirectory,
      environment,
    },
  );
  if (!checked.stdout.includes("GrantTrace check passed")) {
    throw new Error("The installed CLI did not validate its accepted contract.");
  }

  const accepted = JSON.parse(
    await readFile(join(installDirectory, "granttrace.lock.json"), "utf8"),
  );
  if (
    accepted.schemaVersion !== 3 ||
    accepted.scenarios?.length !== 1 ||
    accepted.scenarios[0]?.name !== "package-smoke"
  ) {
    throw new Error("The installed CLI wrote an unexpected contract.");
  }

  await validateEphemeralState(installDirectory);
  await validatePnpmConsumer({
    directory: pnpmInstallDirectory,
    environment: portableEnvironment({
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_store_dir: pnpmStoreDirectory,
      npm_config_update_notifier: "false",
      npm_config_userconfig: userConfigPath,
    }),
    manifest,
    pnpm,
    tarballPath,
  });
  console.log(
    `Package smoke test passed with npm and strict pnpm consumers for ${manifest.name}@${manifest.version} (${String(packResult.files.length)} files).`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function validateManifest(value) {
  if (
    typeof value.version !== "string" ||
    !/^\d+\.\d+\.\d+-beta\.\d+$/u.test(value.version) ||
    typeof value.dependencies?.["@octokit/core"] !== "string" ||
    value.private === true ||
    value.type !== "module" ||
    value.engines?.node !== ">=22" ||
    value.bin?.granttrace !== "dist/cli/bin.js" ||
    value.exports?.["."]?.types !== "./dist/index.d.ts" ||
    value.exports?.["."]?.import !== "./dist/index.js" ||
    value.exports?.["./octokit"]?.types !== "./dist/octokit/index.d.ts" ||
    value.exports?.["./octokit"]?.import !== "./dist/octokit/index.js"
  ) {
    throw new Error("Package metadata is not ready for a beta CLI tarball.");
  }
  const files = [...(value.files ?? [])].sort();
  if (files.join("\n") !== ["LICENSE", "README.md", "dist"].sort().join("\n")) {
    throw new Error("The package files allowlist is not exact.");
  }
}

function validatePackedFiles(files) {
  const seen = new Set();
  for (const entry of files) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.path !== "string" ||
      seen.has(entry.path) ||
      !isAllowedPackagePath(entry.path)
    ) {
      throw new Error("The tarball contains a path outside the package allowlist.");
    }
    seen.add(entry.path);
  }

  for (const required of [
    "LICENSE",
    "README.md",
    "package.json",
    "dist/cli/bin.js",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/octokit/index.js",
    "dist/octokit/index.d.ts",
    "dist/runtime/preload.js",
  ]) {
    if (!seen.has(required)) {
      throw new Error(`The tarball is missing required file ${required}.`);
    }
  }

  const bin = files.find((entry) => entry.path === "dist/cli/bin.js");
  if (
    process.platform !== "win32" &&
    (typeof bin?.mode !== "number" || (bin.mode & 0o111) === 0)
  ) {
    throw new Error("The packaged CLI entry point is not executable.");
  }
}

function validateArchiveEntries(entries, npmFiles) {
  const archivePaths = new Set();
  for (const entry of entries) {
    if (!entry.path.startsWith("package/")) {
      throw new Error("The tarball contains an entry outside package/.");
    }
    const relativePath = entry.path.slice("package/".length);
    if (!isAllowedPackagePath(relativePath) || archivePaths.has(relativePath)) {
      throw new Error("The tarball contains an unsafe or duplicate entry.");
    }
    archivePaths.add(relativePath);
  }
  const npmPaths = new Set(npmFiles.map((entry) => entry.path));
  if (
    archivePaths.size !== npmPaths.size ||
    [...archivePaths].some((path) => !npmPaths.has(path))
  ) {
    throw new Error("npm metadata and the tarball file list disagree.");
  }
}

function isAllowedPackagePath(path) {
  if (["LICENSE", "README.md", "package.json"].includes(path)) {
    return true;
  }
  return (
    path.startsWith("dist/") &&
    !path.includes("..") &&
    !/(?:^|\/)(?:test|tests|fixtures?|examples?|coverage|node_modules|\.cache)(?:\/|$)/u.test(
      path.toLowerCase(),
    ) &&
    /\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(path)
  );
}

async function validateInstalledBin(directory) {
  const binDirectory = join(directory, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? ["granttrace.cmd", "granttrace.ps1"]
      : ["granttrace"];
  const available = await readdir(binDirectory);
  const candidate = candidates.find((entry) => available.includes(entry));
  if (candidate === undefined) {
    throw new Error("The package manager did not install the granttrace bin.");
  }
  const path = join(binDirectory, candidate);
  if (process.platform !== "win32") {
    const details = await stat(path);
    if ((details.mode & 0o111) === 0) {
      throw new Error("The installed granttrace bin is not executable.");
    }
  }
  return path;
}

async function runInstalledCli(
  installedBin,
  installedPackageDirectory,
  args,
  options,
) {
  if (process.platform === "win32") {
    return run(
      process.execPath,
      [
        join(installedPackageDirectory, "dist", "cli", "bin.js"),
        ...args,
      ],
      options,
    );
  }
  return run(installedBin, args, options);
}

async function validatePnpmConsumer(input) {
  await Promise.all([
    writeFile(
      join(input.directory, "package.json"),
      `${JSON.stringify(
        {
          name: "granttrace-pnpm-package-smoke",
          private: true,
          type: "module",
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(input.directory, ".npmrc"),
      [
        "auto-install-peers=false",
        "node-linker=isolated",
        "shamefully-hoist=false",
        "strict-peer-dependencies=true",
        "virtual-store-dir-max-length=40",
        "",
      ].join("\n"),
      { mode: 0o600 },
    ),
  ]);

  const added = await run(
    input.pnpm.command,
    invocationArgs(input.pnpm, [
      "add",
      "--ignore-scripts",
      "--save-dev",
      "--save-exact",
      input.tarballPath,
      `@octokit/core@${input.manifest.dependencies["@octokit/core"]}`,
      `undici@${smokeUndiciVersion}`,
      "@types/node@22.20.1",
      "typescript@7.0.2",
    ]),
    {
      cwd: input.directory,
      environment: input.environment,
      expectedExitCodes: [0, 1],
    },
  );
  assertCommandPassed(added, "The strict pnpm consumer could not install.");

  const consumerManifest = JSON.parse(
    await readFile(join(input.directory, "package.json"), "utf8"),
  );
  if (
    consumerManifest.devDependencies?.[input.manifest.name] === undefined ||
    consumerManifest.devDependencies?.["@octokit/core"] !==
      input.manifest.dependencies["@octokit/core"] ||
    consumerManifest.devDependencies?.undici !== smokeUndiciVersion ||
    consumerManifest.devDependencies?.["@types/node"] !== "22.20.1" ||
    consumerManifest.devDependencies?.typescript !== "7.0.2"
  ) {
    throw new Error(
      "The strict pnpm consumer did not declare every imported package.",
    );
  }
  if (await pathExists(join(input.directory, "node_modules", "zod"))) {
    throw new Error(
      "The pnpm consumer unexpectedly hoisted an undeclared transitive dependency.",
    );
  }

  const imported = await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        "await import('granttrace');",
        "await import('granttrace/octokit');",
        "process.stdout.write('strict-imports-ok');",
      ].join(" "),
    ],
    {
      cwd: input.directory,
      environment: input.environment,
      expectedExitCodes: [0, 1],
    },
  );
  assertCommandPassed(
    imported,
    "The strict pnpm consumer could not import public exports.",
  );
  if (imported.stdout !== "strict-imports-ok") {
    throw new Error("The strict pnpm consumer could not import public exports.");
  }

  const help = await run(
    input.pnpm.command,
    invocationArgs(input.pnpm, ["exec", "granttrace", "--help"]),
    {
      cwd: input.directory,
      environment: input.environment,
      expectedExitCodes: [0, 1],
    },
  );
  assertCommandPassed(help, "The strict pnpm consumer could not run the CLI.");
  if (
    !help.stdout.includes("record     Run, observe, review") ||
    !help.stdout.includes("granttrace record <name> -- <test-command>")
  ) {
    throw new Error("The strict pnpm consumer could not run the CLI.");
  }

  const scenarioPath = join(input.directory, "offline-scenario.mjs");
  await writeFile(scenarioPath, offlineScenarioSource(), { mode: 0o600 });
  const recorded = await run(
    input.pnpm.command,
    invocationArgs(input.pnpm, [
      "exec",
      "granttrace",
      "record",
      "pnpm-package-smoke",
      "--",
      process.execPath,
      scenarioPath,
    ]),
    {
      cwd: input.directory,
      environment: input.environment,
      expectedExitCodes: [6],
    },
  );
  if (
    !recorded.stdout.includes("GrantTrace initialized") ||
    !recorded.stdout.includes("GrantTrace record complete") ||
    !recorded.stderr.includes("GrantTrace contract review required")
  ) {
    throw new Error(
      `The strict pnpm consumer did not automatically record ordinary Octokit traffic:\n${recorded.stdout}${recorded.stderr}`,
    );
  }
  if (
    (await readFile(join(input.directory, ".gitignore"), "utf8")) !==
    ".granttrace/\n"
  ) {
    throw new Error(
      "The strict pnpm consumer did not ignore its private local state.",
    );
  }
  await validateEphemeralState(input.directory, "pnpm-package-smoke");

  await Promise.all([
    writeFile(join(input.directory, "consumer.ts"), typescriptConsumerSource(), {
      mode: 0o600,
    }),
    writeFile(
      join(input.directory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "NodeNext",
            moduleResolution: "NodeNext",
            noEmit: true,
            strict: true,
            target: "ES2023",
            types: ["node"],
          },
          include: ["consumer.ts"],
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
  ]);
  const typecheck = await run(
    input.pnpm.command,
    invocationArgs(input.pnpm, [
      "exec",
      "tsc",
      "--project",
      join(input.directory, "tsconfig.json"),
    ]),
    {
      cwd: input.directory,
      environment: input.environment,
      expectedExitCodes: [0, 1, 2],
    },
  );
  if (typecheck.code !== 0) {
    throw new Error(
      `The strict pnpm TypeScript consumer failed:\n${typecheck.stdout}${typecheck.stderr}`,
    );
  }
}

function assertCommandPassed(result, message) {
  if (result.code !== 0) {
    throw new Error(`${message}\n${result.stdout}${result.stderr}`);
  }
}

async function validateEphemeralState(directory, scenario = "package-smoke") {
  if (process.platform !== "win32") {
    for (const [path, expected] of [
      [join(directory, ".granttrace"), 0o700],
      [join(directory, ".granttrace", "sessions"), 0o700],
      [join(directory, ".granttrace", "observations"), 0o700],
      [
        join(
          directory,
          ".granttrace",
          "observations",
          `${scenario}.ndjson`,
        ),
        0o600,
      ],
    ]) {
      const details = await stat(path);
      if ((details.mode & 0o777) !== expected) {
        throw new Error("GrantTrace created an artifact with unsafe permissions.");
      }
    }
  }

  const sessions = await readdir(join(directory, ".granttrace", "sessions"));
  if (sessions.length !== 0) {
    throw new Error("The installed CLI left proof or record session residue.");
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function typescriptConsumerSource() {
  return `import { parseAcceptedPermissionsHeader } from "granttrace";
import { GrantTraceOctokit } from "granttrace/octokit";

const octokit = new GrantTraceOctokit();
const permissions = parseAcceptedPermissionsHeader("contents=read");

void octokit;
void permissions;
`;
}

function offlineScenarioSource() {
  return `import { Octokit } from "@octokit/core";
import { MockAgent, setGlobalDispatcher } from "undici";

const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
mockAgent
  .get("https://api.github.com")
  .intercept({
    method: "GET",
    path: "/repos/offline-owner/offline-repository/contents/README.md",
  })
  .reply(200, {}, {
    headers: {
      "content-type": "application/json",
      "x-accepted-github-permissions": "contents=read",
    },
  });
setGlobalDispatcher(mockAgent);

try {
  const octokit = new Octokit();
  await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: "offline-owner",
    repo: "offline-repository",
    path: "README.md",
  });
} finally {
  await mockAgent.close();
}
`;
}
