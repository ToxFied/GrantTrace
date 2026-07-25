import assert from "node:assert/strict";
import test from "node:test";

import { postTriageComment, type GitHubRequest } from "./src/triage.js";

test("posts a stable triage comment to the selected issue", async () => {
  const request: GitHubRequest = async <Result>(
    route: string,
    parameters: Record<string, unknown>,
  ) => {
    assert.equal(
      route,
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    );
    assert.deepEqual(parameters, {
      owner: "example-owner",
      repo: "example-repository",
      issue_number: 42,
      body: "Thanks for the report. A maintainer has added it to the triage queue.",
    });
    return { id: 734 } as Result;
  };

  const commentId = await postTriageComment(request, {
    owner: "example-owner",
    repository: "example-repository",
    issueNumber: 42,
  });

  assert.equal(commentId, 734);
});
