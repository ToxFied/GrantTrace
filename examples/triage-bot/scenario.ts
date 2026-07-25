import { createServer } from "node:http";

import { GrantTraceOctokit } from "granttrace/octokit";

import { postTriageComment, type GitHubRequest } from "./src/triage.js";

const stub = createServer((request, response) => {
  request.resume();
  request.once("end", () => {
    response.writeHead(201, { "content-type": "application/json" });
    response.end('{"id":734}');
  });
});

await new Promise<void>((resolve, reject) => {
  stub.once("error", reject);
  stub.listen(0, "127.0.0.1", resolve);
});

try {
  const address = stub.address();
  if (address === null || typeof address === "string") {
    throw new Error("The example GitHub stub did not start.");
  }

  const octokit = new GrantTraceOctokit({
    auth: "synthetic-example-token",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
  const request: GitHubRequest = async <Result>(
    route: string,
    parameters: Record<string, unknown>,
  ) => {
    const response = await octokit.request(route, parameters);
    return response.data as Result;
  };

  await postTriageComment(request, {
    owner: "example-owner",
    repository: "example-repository",
    issueNumber: 42,
  });
} finally {
  await new Promise<void>((resolve) => {
    stub.close(() => resolve());
  });
}
