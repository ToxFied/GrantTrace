import { createServer, type Server } from "node:http";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Octokit } from "@octokit/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import { loadObservations } from "../../src/contract/observation-file.js";
import { serializeContract } from "../../src/contract/serialize.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import { createRecorderConfig } from "../../src/octokit/config.js";
import {
  ApiVersionMismatchError,
  createGrantTracePlugin,
  RecorderPersistenceError,
} from "../../src/octokit/plugin.js";
import { renderAnalysisReport } from "../../src/reporting/terminal.js";

const canary = {
  installationToken: "ghs_RECORDER_TOKEN_CANARY",
  userToken: "ghu_USER_TOKEN_CANARY",
  privateKey: "-----BEGIN PRIVATE KEY-----",
  owner: "owner-canary-private",
  repository: "repo-canary-private",
  body: "body-canary-private",
  cookie: "cookie-canary-private",
  query: "query-canary-private",
  numericId: "742019283",
  uuid: "8f14e45f-ea7d-4f2d-a56a-c0ffee123456",
  basicAuthUrl:
    "https://basic-user:basic-password@api.github.com/private/path",
} as const;
const canaries = Object.values(canary);

describe("Octokit recorder against a local stub", () => {
  let server: Server;
  let baseUrl: string;
  let sessionDirectory: string;
  let responseStatus = 201;
  let responseHeader: string | null =
    "pull_requests=write; issues=write";
  let responseDelay = 0;
  let seenApiVersions: Array<string | undefined> = [];

  beforeEach(async () => {
    responseStatus = 201;
    responseHeader = "pull_requests=write; issues=write";
    responseDelay = 0;
    seenApiVersions = [];
    sessionDirectory = await mkdtemp(join(tmpdir(), "granttrace-recorder-"));
    await chmod(sessionDirectory, 0o700);
    server = createServer((request, response) => {
      const apiVersion = request.headers["x-github-api-version"];
      seenApiVersions.push(
        Array.isArray(apiVersion) ? apiVersion.join(",") : apiVersion,
      );
      request.resume();
      request.once("end", () => {
        setTimeout(() => {
          const headers: Record<string, string> = {
            "content-type": "application/json",
          };
          if (responseHeader !== null) {
            headers["x-accepted-github-permissions"] = responseHeader;
          }
          response.writeHead(responseStatus, headers);
          response.end(
            JSON.stringify({
              ignored: "response-body-canary-private",
            }),
          );
        }, responseDelay);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Stub server did not bind.");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await rm(sessionDirectory, { recursive: true, force: true });
  });

  it("records only the canonical template and parsed response evidence", async () => {
    const octokit = createOctokit(sessionDirectory, baseUrl);

    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: canary.owner,
        repo: canary.repository,
        issue_number: Number(canary.numericId),
        body: `${canary.body} ${canary.privateKey} ${canary.uuid} ${canary.basicAuthUrl}`,
        headers: {
          cookie: canary.cookie,
          "x-extra-canary": canary.userToken,
        },
      },
    );

    responseHeader = "contents=read";
    await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: canary.owner,
        repo: canary.repository,
        path: "fixture.txt",
        ref: canary.query,
      },
    );

    const observations = await loadObservations(
      join(sessionDirectory, "observations.ndjson"),
    );
    expect(observations).toHaveLength(2);
    expect(observations[0]?.routeTemplate).toContain("{owner}");
    expect(observations[0]?.routeTemplate).toContain("{repo}");
    expect(seenApiVersions).toEqual(["2026-03-10", "2026-03-10"]);

    const artifact = await readAllFiles(sessionDirectory);
    const report = renderAnalysisReport(
      buildContract(observations, fixtureCatalog),
      observations.length,
    );
    const retained = `${artifact}\n${report}`;
    for (const canary of canaries) {
      expect(retained).not.toContain(canary);
    }
    expect(retained).not.toContain("response-body-canary-private");
  });

  it("records accepted-permission evidence from an Octokit HTTP error", async () => {
    responseStatus = 403;
    const octokit = createOctokit(sessionDirectory, baseUrl);

    await expect(
      octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: canary.owner,
          repo: canary.repository,
          issue_number: Number(canary.numericId),
          body: canary.body,
        },
      ),
    ).rejects.toMatchObject({ status: 403 });

    const observations = await loadObservations(
      join(sessionDirectory, "observations.ndjson"),
    );
    expect(observations[0]).toMatchObject({
      status: 403,
      evidenceSource: "runtime_header",
      finding: null,
    });
    expect(await readAllFiles(sessionDirectory)).not.toContain(canary.owner);
  });

  it("fails closed for malformed, missing, concrete, and GraphQL evidence", async () => {
    const octokit = createOctokit(sessionDirectory, baseUrl);

    responseHeader = "issues=admin";
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: canary.owner,
        repo: canary.repository,
        issue_number: 1,
        body: "ignored",
      },
    );

    responseHeader = null;
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: canary.owner,
        repo: canary.repository,
        issue_number: 2,
        body: "ignored",
      },
    );

    responseHeader = "issues=write";
    await octokit.request(
      `POST ${baseUrl}/repos/${canary.owner}/${canary.repository}/issues/3/comments?token=${canary.installationToken}`,
      { body: "ignored" },
    );
    await octokit.request("POST /graphql", {
      query: `query { viewer { login } } ${canary.body}`,
    });

    const observations = await loadObservations(
      join(sessionDirectory, "observations.ndjson"),
    );
    expect(observations.map((observation) => observation.finding)).toEqual([
      "malformed_header",
      "missing_evidence",
      "unresolved_route",
      "unsupported_api",
    ]);
    const artifact = await readAllFiles(sessionDirectory);
    for (const canary of canaries) {
      expect(artifact).not.toContain(canary);
    }
  });

  it("produces a byte-identical contract after concurrent completion reordering", async () => {
    responseDelay = 5;
    const octokit = createOctokit(sessionDirectory, baseUrl);
    await Promise.all(
      [4, 3, 2, 1].map((issueNumber) =>
        octokit.request(
          "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
          {
            owner: canary.owner,
            repo: canary.repository,
            issue_number: issueNumber,
            body: "ignored",
          },
        ),
      ),
    );

    const observations = await loadObservations(
      join(sessionDirectory, "observations.ndjson"),
    );
    const forward = serializeContract(
      buildContract(observations, fixtureCatalog),
    );
    const reverse = serializeContract(
      buildContract([...observations].reverse(), fixtureCatalog),
    );
    expect(reverse).toBe(forward);
  });

  it("refuses a conflicting explicit REST API version", async () => {
    const octokit = createOctokit(sessionDirectory, baseUrl);
    await expect(
      octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: canary.owner,
          repo: canary.repository,
          issue_number: 1,
          body: "ignored",
          headers: {
            "x-github-api-version": "2022-11-28",
          },
        },
      ),
    ).rejects.toBeInstanceOf(ApiVersionMismatchError);
    expect(seenApiVersions).toEqual([]);
  });

  it("keeps a recorder persistence failure fatal for the whole session", async () => {
    const observationsPath = join(sessionDirectory, "observations.ndjson");
    await mkdir(observationsPath);
    const octokit = createOctokit(sessionDirectory, baseUrl);
    const request = () =>
      octokit.request(
        "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        {
          owner: canary.owner,
          repo: canary.repository,
          issue_number: 1,
          body: "ignored",
        },
      );

    await expect(request()).rejects.toBeInstanceOf(RecorderPersistenceError);
    await rm(observationsPath, { recursive: true });
    await expect(request()).rejects.toBeInstanceOf(RecorderPersistenceError);
    await expect(access(observationsPath)).rejects.toBeDefined();
  });
});

function createOctokit(sessionDirectory: string, baseUrl: string) {
  const config = createRecorderConfig(
    "triage-integration",
    sessionDirectory,
  );
  const TracedOctokit = Octokit.plugin(createGrantTracePlugin(config));
  return new TracedOctokit({
    auth: canary.installationToken,
    baseUrl,
  });
}

async function readAllFiles(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(directory, entry.name), "utf8")),
  );
  return contents.join("\n");
}
