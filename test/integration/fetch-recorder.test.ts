import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

import { Octokit } from "@octokit/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadObservations } from "../../src/contract/observation-file.js";
import { createRecorderConfig } from "../../src/octokit/config.js";
import { ApiVersionMismatchError, RecorderPersistenceError } from "../../src/recorder/errors.js";
import { withoutAutomaticCapture } from "../../src/recorder/suppression.js";
import { installFetchRecorder } from "../../src/runtime/fetch-recorder.js";

const canaries = [
  "private-owner",
  "private-repository",
  "private-token",
  "private-body",
  "private-query",
  "private-response",
] as const;

describe("automatic fetch recorder", () => {
  let sessionDirectory: string;
  let restoreFetch: (() => void) | null;

  beforeEach(async () => {
    restoreFetch = null;
    sessionDirectory = await mkdtemp(join(tmpdir(), "granttrace-fetch-"));
    await chmod(sessionDirectory, 0o700);
  });

  afterEach(async () => {
    restoreFetch?.();
    await rm(sessionDirectory, { recursive: true, force: true });
  });

  it("pins the API version and records only a canonical route and evidence", async () => {
    let forwardedHeaders: Headers | null = null;
    const target = createTarget(async (_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
      return new Response(`{"secret":"${canaries[5]}"}`, {
        status: 201,
        headers: {
          "x-accepted-github-permissions":
            "pull_requests=write; issues=write",
        },
      });
    });
    installFetchRecorder(config(), target);

    const response = await target.fetch(
      `https://api.github.com/repos/${canaries[0]}/${canaries[1]}/issues/7/comments?token=${canaries[4]}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${canaries[2]}`,
          "x-private-header": canaries[2],
        },
        body: canaries[3],
      },
    );

    expect(response.status).toBe(201);
    expect((forwardedHeaders as Headers | null)?.get("x-github-api-version"))
      .toBe("2026-03-10");
    expect((forwardedHeaders as Headers | null)?.get("authorization"))
      .toContain(canaries[2]);
    expect(await response.text()).toContain(canaries[5]);

    const observations = await loadObservations(observationPath());
    expect(observations).toEqual([
      {
        schemaVersion: 1,
        scenario: "automatic-fetch",
        method: "POST",
        routeTemplate:
          "/repos/{owner}/{repo}/issues/{issue_number}/comments",
        status: 201,
        requirements: [
          [{ permission: "issues", level: "write" }],
          [{ permission: "pull_requests", level: "write" }],
        ],
        evidenceSource: "runtime_header",
        finding: null,
      },
    ]);
    const artifact = await readAllFiles(sessionDirectory);
    for (const canary of canaries) {
      expect(artifact).not.toContain(canary);
    }
  });

  it("supports Request inputs and custom init overrides", async () => {
    let forwardedMethod: string | undefined;
    let forwardedHeaders: Headers | null = null;
    const target = createTarget(async (_input, init) => {
      forwardedMethod = init?.method;
      forwardedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });
    installFetchRecorder(config(), target);
    const request = new Request(
      "https://api.github.com/repos/private-owner/private-repository/issues",
      {
        headers: {
          authorization: "Bearer private-token",
        },
      },
    );

    await target.fetch(request, {
      method: "POST",
      headers: {
        "x-custom-init": "kept",
      },
    });

    expect(forwardedMethod).toBe("POST");
    expect((forwardedHeaders as Headers | null)?.get("x-custom-init"))
      .toBe("kept");
    expect((forwardedHeaders as Headers | null)?.get("authorization"))
      .toBeNull();
    expect((forwardedHeaders as Headers | null)?.get("x-github-api-version"))
      .toBe("2026-03-10");
    expect(await loadObservations(observationPath())).toMatchObject([
      {
        method: "POST",
        routeTemplate: "/repos/{owner}/{repo}/issues",
        finding: "missing_evidence",
      },
    ]);
  });

  it("passes non-GitHub fetches through without changing their arguments", async () => {
    const original = vi.fn(async () => new Response("ok"));
    const target = createTarget(original);
    installFetchRecorder(config(), target);
    const init = {
      headers: { authorization: "Bearer private-token" },
    };

    await target.fetch("https://example.com/private-owner", init);

    expect(original).toHaveBeenCalledWith(
      "https://example.com/private-owner",
      init,
    );
    expect(await readdir(sessionDirectory)).toEqual(["plugin-loaded"]);
  });

  it("captures a custom GitHub API base only when its response carries permission evidence", async () => {
    const original = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("ordinary response"))
      .mockResolvedValueOnce(
        new Response("GitHub response", {
          headers: {
            "x-accepted-github-permissions": "issues=read",
          },
        }),
      );
    const target = createTarget(original);
    installFetchRecorder(config(), target);
    const url =
      "http://127.0.0.1:43210/repos/private-owner/private-repository/issues";

    await target.fetch(url, {
      headers: { authorization: "Bearer private-token" },
    });
    expect(await readdir(sessionDirectory)).toEqual(["plugin-loaded"]);

    await target.fetch(url, {
      headers: { authorization: "Bearer private-token" },
    });

    expect(original.mock.calls[1]?.[1]).toEqual({
      headers: { authorization: "Bearer private-token" },
    });
    expect(await loadObservations(observationPath())).toMatchObject([
      {
        method: "GET",
        routeTemplate: "/repos/{owner}/{repo}/issues",
        requirements: [[{ permission: "issues", level: "read" }]],
        evidenceSource: "runtime_header",
        finding: null,
      },
    ]);
    const artifact = await readAllFiles(sessionDirectory);
    for (const canary of canaries) {
      expect(artifact).not.toContain(canary);
    }
  });

  it("captures ordinary Octokit without a GrantTrace-specific client", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.once("end", () => {
        response.writeHead(200, {
          "content-type": "application/json",
          "x-accepted-github-permissions": "issues=read",
        });
        response.end("[]");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("GitHub stub did not bind.");
      }
      restoreFetch = installFetchRecorder(config());
      const octokit = new Octokit({
        auth: "private-token",
        baseUrl: `http://127.0.0.1:${address.port}`,
      });

      await octokit.request("GET /repos/{owner}/{repo}/issues", {
        owner: "private-owner",
        repo: "private-repository",
      });

      expect(await loadObservations(observationPath())).toMatchObject([
        {
          method: "GET",
          routeTemplate: "/repos/{owner}/{repo}/issues",
          requirements: [[{ permission: "issues", level: "read" }]],
          evidenceSource: "runtime_header",
          finding: null,
        },
      ]);
      const artifact = await readAllFiles(sessionDirectory);
      for (const canary of canaries) {
        expect(artifact).not.toContain(canary);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("records unresolved GitHub REST routes without blocking the response", async () => {
    const target = createTarget(async () => new Response("ok"));
    installFetchRecorder(config(), target);

    const response = await target.fetch(
      "https://api.github.com/private-owner/private-repository",
    );

    expect(await response.text()).toBe("ok");
    const artifact = await readAllFiles(sessionDirectory);
    expect(artifact).not.toContain("private-owner");
    expect(await loadObservations(observationPath())).toMatchObject([
      {
        method: "GET",
        routeTemplate: null,
        finding: "unresolved_route",
      },
    ]);
  });

  it("preserves the original network error object after recording", async () => {
    const networkError = new TypeError("network failure");
    const target = createTarget(async () => {
      throw networkError;
    });
    installFetchRecorder(config(), target);

    await expect(
      target.fetch(
        "https://api.github.com/repos/private-owner/private-repository/issues",
      ),
    ).rejects.toBe(networkError);
    expect(await loadObservations(observationPath())).toMatchObject([
      {
        status: null,
        routeTemplate: "/repos/{owner}/{repo}/issues",
        finding: "missing_evidence",
      },
    ]);
  });

  it("rejects a conflicting explicit API version before sending", async () => {
    const original = vi.fn(async () => new Response("unreachable"));
    const target = createTarget(original);
    installFetchRecorder(config(), target);

    await expect(
      target.fetch(
        "https://api.github.com/repos/private-owner/private-repository/issues",
        {
          headers: {
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      ),
    ).rejects.toBeInstanceOf(ApiVersionMismatchError);
    expect(original).not.toHaveBeenCalled();
  });

  it("lets explicit GrantTrace instrumentation suppress automatic duplicates", async () => {
    const target = createTarget(async () => new Response("ok"));
    installFetchRecorder(config(), target);

    await withoutAutomaticCapture(() =>
      target.fetch(
        "https://api.github.com/repos/private-owner/private-repository/issues",
      ),
    );

    expect(await readdir(sessionDirectory)).toEqual(["plugin-loaded"]);
  });

  it("keeps a recorder persistence failure fatal for later requests", async () => {
    await mkdir(observationPath());
    const target = createTarget(async () => new Response("ok"));
    installFetchRecorder(config(), target);
    const request = () =>
      target.fetch(
        "https://api.github.com/repos/private-owner/private-repository/issues",
      );

    await expect(request()).rejects.toBeInstanceOf(RecorderPersistenceError);
    await rm(observationPath(), { recursive: true });
    await expect(request()).rejects.toBeInstanceOf(RecorderPersistenceError);
  });

  function config() {
    return createRecorderConfig(
      "automatic-fetch",
      sessionDirectory,
    );
  }

  function observationPath() {
    return join(sessionDirectory, "observations.ndjson");
  }
});

function createTarget(
  implementation: typeof fetch,
): { fetch: typeof fetch } {
  return { fetch: implementation };
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
