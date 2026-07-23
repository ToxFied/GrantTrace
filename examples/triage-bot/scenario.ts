import { createServer } from "node:http";

import { Octokit } from "@octokit/core";

import { grantTrace } from "../../src/octokit/index.js";

const stub = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.writeHead(201, {
      "content-type": "application/json",
      "x-accepted-github-permissions":
        "issues=write; pull_requests=write",
    });
    response.end('{"id":1}');
  });
});

await new Promise<void>((resolve, reject) => {
  stub.once("error", reject);
  stub.listen(0, "127.0.0.1", resolve);
});

try {
  const address = stub.address();
  if (address === null || typeof address === "string") {
    throw new Error("Local GitHub stub did not start.");
  }

  const TracedOctokit = Octokit.plugin(grantTrace);
  const octokit = new TracedOctokit({
    auth: "local-stub-token",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });

  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: "not-persisted-owner",
      repo: "not-persisted-repository",
      issue_number: 42,
      body: "This body is never persisted.",
    },
  );
} finally {
  await new Promise<void>((resolve) => {
    stub.close(() => resolve());
  });
}
