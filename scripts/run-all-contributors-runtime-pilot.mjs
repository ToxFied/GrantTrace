import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createRequire } from "node:module";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { buildContract } from "../src/contract/build.ts";
import { loadObservations } from "../src/contract/observation-file.ts";
import { githubPermissionCatalog } from "../src/evidence/catalog.ts";
import { createRecorderConfig } from "../src/octokit/config.ts";
import { createGrantTracePlugin } from "../src/octokit/plugin.ts";
import {
  isSyntacticallySafeTemplate,
  safeMethod,
} from "../src/routes/canonical.ts";
import { portableEnvironment, run } from "./lib/process.mjs";
import { projectRoot } from "./lib/project.mjs";

const repository = "https://github.com/all-contributors/app.git";
const commit = "00f6362ffcc927a2d05fec27f42c3d09e4b03adb";
const packageLockSha256 =
  "0b05468b4debbc54eb1d88d0c4778d50f68a6e40d7ed398dbdc593960b10ca24";
const scenario = "all-contributors-mocked-runtime";
const maximumLockfileBytes = 2 * 1024 * 1024;
const scriptPath = fileURLToPath(import.meta.url);
const assetDirectory = join(
  projectRoot,
  "case-studies",
  "all-contributors-app",
);

const internalArguments = parseInternalArguments(process.argv.slice(2));
if (internalArguments !== null) {
  await executeRuntime(internalArguments);
} else {
  await runPilot(parsePublicArguments(process.argv.slice(2)));
}

async function runPilot(options) {
  let ownedRoot = null;
  let ownedRuntimeRoot = null;
  let upstreamDirectory = options.upstream;
  const setup = [];

  try {
    if (upstreamDirectory === null) {
      ownedRoot = await mkdtemp(
        join(tmpdir(), "granttrace-all-contributors-runtime-"),
      );
      upstreamDirectory = join(ownedRoot, "upstream");
      setup.push(
        await runMeasured(
          "git",
          ["clone", "--no-checkout", repository, upstreamDirectory],
          { cwd: ownedRoot },
        ),
      );
      setup.push(
        await runMeasured("git", ["checkout", "--detach", commit], {
          cwd: upstreamDirectory,
        }),
      );
      setup.push(
        await runMeasured("npm", ["ci", "--ignore-scripts"], {
          cwd: upstreamDirectory,
        }),
      );
    }

    await assertPinnedCheckout(upstreamDirectory);
    if (ownedRoot === null) {
      ownedRuntimeRoot = await mkdtemp(
        join(tmpdir(), "granttrace-all-contributors-run-"),
      );
    }
    const runtimeRoot = ownedRoot ?? ownedRuntimeRoot;
    if (runtimeRoot === null) {
      throw new Error("Could not create the runtime pilot directory.");
    }
    const sessionDirectory = join(runtimeRoot, "session");
    const resultDirectory = join(runtimeRoot, "result");
    await Promise.all([
      createPrivateDirectory(sessionDirectory),
      createPrivateDirectory(resultDirectory),
    ]);

    const runtime = await runMeasured(
      process.execPath,
      [
        "--import=tsx",
        scriptPath,
        "--execute",
        upstreamDirectory,
        sessionDirectory,
        resultDirectory,
      ],
      { cwd: projectRoot },
    );

    const observationPath = join(sessionDirectory, "observations.ndjson");
    const emittedPath = join(resultDirectory, "emitted-requests.json");
    const [actualObservations, expectedObservations, actualEmitted, expectedEmitted] =
      await Promise.all([
        readFile(observationPath, "utf8"),
        readFile(join(assetDirectory, "runtime.observations.ndjson"), "utf8"),
        readJson(emittedPath),
        readJson(join(assetDirectory, "runtime-emitted-requests.json")),
      ]);

    if (actualObservations !== expectedObservations) {
      throw new Error(
        "Runtime observations differ from the checked-in pilot evidence.",
      );
    }
    if (!isDeepStrictEqual(actualEmitted, expectedEmitted)) {
      throw new Error(
        "Emitted request routes differ from the checked-in pilot evidence.",
      );
    }

    const observations = await loadObservations(observationPath);
    const contract = buildContract(observations, githubPermissionCatalog);
    const uniqueRoutes = new Set(
      actualEmitted.requests.map(
        (request) => `${request.method} ${request.routeTemplate}`,
      ),
    );
    console.log(
      JSON.stringify(
        {
          upstreamCommit: commit,
          execution: "credential-free mocked Probot runtime",
          liveGitHub: false,
          networkBoundary: "nock.disableNetConnect()",
          setup,
          runtime: {
            command: runtime.command,
            elapsedSeconds: runtime.elapsedSeconds,
          },
          requestCount: actualEmitted.requests.length,
          uniqueRouteCount: uniqueRoutes.size,
          selectedPermissionsForResolvableSubset:
            contract.selectedPermissions,
          unresolvedMethods: contract.unknowns.map((unknown) => unknown.method),
          evidenceMatched: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (ownedRuntimeRoot !== null) {
      await rm(ownedRuntimeRoot, { recursive: true, force: true });
    }
    if (ownedRoot !== null) {
      await rm(ownedRoot, { recursive: true, force: true });
    }
  }
}

async function executeRuntime({
  upstreamDirectory,
  sessionDirectory,
  resultDirectory,
}) {
  await assertPinnedCheckout(upstreamDirectory);
  const require = createRequire(join(upstreamDirectory, "package.json"));
  const nock = require("nock");

  // This request chain is adapted from the pinned, MIT-licensed upstream
  // happy-path Probot test:
  // https://github.com/all-contributors/app/blob/00f6362ffcc927a2d05fec27f42c3d09e4b03adb/test/integration/issue_comment.test.js#L48-L134
  nock.disableNetConnect();
  try {
    const { Probot, ProbotOctokit } = require("probot");
    const pino = require("pino");
    const app = require(join(upstreamDirectory, "app.js"));
    const fixture = (name) =>
      require(join(upstreamDirectory, "test", "fixtures", name));
    const emitted = [];
    const config = createRecorderConfig(scenario, sessionDirectory);
    const capturePlugin = (octokit) => {
      octokit.hook.wrap("request", async (request, requestOptions) => {
        try {
          const response = await request(requestOptions);
          captureEmittedRequest(emitted, requestOptions, response.status);
          return response;
        } catch (error) {
          captureEmittedRequest(
            emitted,
            requestOptions,
            responseStatus(error),
          );
          throw error;
        }
      });
    };
    const Octokit = ProbotOctokit.plugin(
      createGrantTracePlugin(config),
      capturePlugin,
    ).defaults({
      log: pino({ level: "silent" }),
      retry: { enabled: false },
      throttle: { enabled: false },
    });
    const probot = new Probot({
      githubToken: "test",
      Octokit,
      log: pino({ level: "silent" }),
    });
    await probot.load(app);

    const mock = nock("https://api.github.com")
      .get(
        "/repos/all-contributors/all-contributors-bot/git/ref/heads%2Fall-contributors%2Fadd-jakebolam",
      )
      .reply(404)
      .get(
        "/repos/all-contributors/all-contributors-bot/contents/.all-contributorsrc?ref=master",
      )
      .reply(200, fixture("repos.getContents.all-contributorsrc.json"))
      .get("/users/jakebolam")
      .reply(200, fixture("users.getByUsername.jakebolam.json"))
      .get(
        "/repos/all-contributors/all-contributors-bot/contents/README.md?ref=master",
      )
      .reply(200, fixture("repos.getContents.README.md.json"))
      .get(
        "/repos/all-contributors/all-contributors-bot/git/ref/heads%2Fmaster",
      )
      .reply(200, fixture("git.getRef.json"))
      .post("/repos/all-contributors/all-contributors-bot/git/refs")
      .reply(201, fixture("git.createRef.json"))
      .put(
        "/repos/all-contributors/all-contributors-bot/contents/.all-contributorsrc",
      )
      .reply(200, fixture("repos.updateFile.json"))
      .put("/repos/all-contributors/all-contributors-bot/contents/README.md")
      .reply(200, fixture("repos.updateFile.json"))
      .post("/repos/all-contributors/all-contributors-bot/pulls")
      .reply(201, fixture("pulls.create.json"))
      .post(
        "/repos/all-contributors/all-contributors-bot/issues/1/comments",
      )
      .reply(200);

    await probot.receive({
      name: "issue_comment",
      id: "1",
      payload: fixture("issue_comment.created.json"),
    });
    if (!mock.isDone()) {
      throw new Error(
        `The upstream mocked request path was incomplete: ${mock
          .pendingMocks()
          .join(", ")}`,
      );
    }

    const emittedAsset = {
      schemaVersion: 1,
      captureKind: "credential-free-mocked-octokit-runtime",
      upstreamCommit: commit,
      scenario,
      liveGitHub: false,
      networkBoundary: "nock.disableNetConnect()",
      requests: emitted,
    };
    await writeFile(
      join(resultDirectory, "emitted-requests.json"),
      `${JSON.stringify(emittedAsset, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  } finally {
    nock.cleanAll();
    nock.enableNetConnect();
  }
}

function captureEmittedRequest(target, options, status) {
  const method = safeMethod(options.method);
  const routeTemplate = options.url;
  if (
    method === "UNKNOWN" ||
    typeof routeTemplate !== "string" ||
    !isSyntacticallySafeTemplate(routeTemplate) ||
    !Number.isInteger(status) ||
    status < 100 ||
    status > 599
  ) {
    throw new Error("The runtime emitted an unsafe or invalid request record.");
  }
  target.push({ method, routeTemplate, status });
}

function responseStatus(error) {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response
  ) {
    return error.response.status;
  }
  return "status" in error ? error.status : null;
}

async function assertPinnedCheckout(directory) {
  if (!isAbsolute(directory)) {
    throw new Error("The upstream checkout path must be absolute.");
  }
  const environment = childEnvironment();
  const revision = await run("git", ["rev-parse", "HEAD"], {
    cwd: directory,
    environment,
  });
  if (revision.stdout.trim() !== commit) {
    throw new Error(`The upstream checkout must be pinned at ${commit}.`);
  }
  const status = await run(
    "git",
    ["status", "--short", "--untracked-files=no"],
    { cwd: directory, environment },
  );
  if (status.stdout.trim().length !== 0) {
    throw new Error("The pinned upstream checkout has tracked modifications.");
  }

  const lockfilePath = join(directory, "package-lock.json");
  const details = await lstat(lockfilePath);
  if (!details.isFile() || details.isSymbolicLink() || details.size > maximumLockfileBytes) {
    throw new Error("The pinned upstream lockfile is unavailable.");
  }
  const lockfile = await readFile(lockfilePath);
  const checksum = createHash("sha256").update(lockfile).digest("hex");
  if (checksum !== packageLockSha256) {
    throw new Error("The pinned upstream package-lock checksum differs.");
  }
}

async function runMeasured(command, args, options) {
  const started = performance.now();
  await run(command, args, {
    ...options,
    environment: childEnvironment(),
    outputLimit: 8 * 1024 * 1024,
  });
  return {
    command: renderCommand(command, args),
    elapsedSeconds: Number(((performance.now() - started) / 1_000).toFixed(3)),
  };
}

function childEnvironment() {
  return portableEnvironment({
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
  });
}

function renderCommand(command, args) {
  return [command, ...args]
    .map((argument) =>
      /^[A-Za-z0-9_./:=@+-]+$/u.test(argument)
        ? argument
        : JSON.stringify(argument),
    )
    .join(" ");
}

async function createPrivateDirectory(path) {
  await mkdir(path, { mode: 0o700 });
  await chmod(path, 0o700);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parsePublicArguments(args) {
  if (args.length === 0) {
    return { upstream: null };
  }
  if (args.length === 2 && args[0] === "--upstream") {
    const upstream = resolve(args[1]);
    return { upstream };
  }
  throw new Error(
    "Usage: pnpm case-study:runtime [--upstream /absolute/pinned/checkout]",
  );
}

function parseInternalArguments(args) {
  if (args[0] !== "--execute") {
    return null;
  }
  if (args.length !== 4) {
    throw new Error("Invalid internal runtime harness invocation.");
  }
  return {
    upstreamDirectory: args[1],
    sessionDirectory: args[2],
    resultDirectory: args[3],
  };
}
