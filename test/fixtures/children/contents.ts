import { createServer } from "node:http";

import { Octokit } from "@octokit/core";

import { grantTrace } from "../../../src/octokit/plugin.js";

const server = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.writeHead(200, {
      "content-type": "application/json",
      "x-accepted-github-permissions": "contents=read",
    });
    response.end('{"type":"file"}');
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
    auth: "ghs_CHILD_CONTENTS_CANARY",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
    owner: "contents-owner-canary",
    repo: "contents-repo-canary",
    path: "secret-path-canary",
    ref: "secret-query-canary",
  });
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
