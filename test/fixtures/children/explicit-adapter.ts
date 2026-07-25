import { createServer } from "node:http";

import { Octokit } from "@octokit/core";

import { grantTrace } from "../../../src/octokit/plugin.js";

const server = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.writeHead(201, {
      "content-type": "application/json",
      "x-accepted-github-permissions":
        "pull_requests=write; issues=write",
    });
    response.end('{"ok":true}');
  });
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
    auth: "ghs_AUTOMATIC_CHILD_CANARY",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });

  await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: "automatic-owner-canary",
      repo: "automatic-repo-canary",
      issue_number: 402_001,
      body: "automatic-body-canary",
    },
  );
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}
