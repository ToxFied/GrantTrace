import { createServer } from "node:http";

import { Octokit } from "@octokit/core";

import { grantTrace } from "../../../src/octokit/plugin.js";

const server = createServer((request) => {
  request.socket.destroy();
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Stub server did not bind to a TCP port.");
  }

  const TracedOctokit = Octokit.plugin(grantTrace);
  const octokit = new TracedOctokit({
    auth: "ghs_FAILED_REQUEST_CANARY",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: "failed-owner-canary",
        repo: "failed-repo-canary",
        issue_number: 999_992,
        body: "failed-body-canary",
      },
    );
  } catch {
    // Reproduce a test that handles its request failure and exits successfully.
  }
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
