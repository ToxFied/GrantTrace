import { Octokit } from "@octokit/core";

const token = requiredEnvironment("GITHUB_TOKEN");
const owner = requiredEnvironment("GRANTTRACE_LIVE_OWNER");
const repository = requiredEnvironment("GRANTTRACE_LIVE_REPOSITORY");
const issueNumber = Number(
  requiredEnvironment("GRANTTRACE_LIVE_ISSUE_NUMBER"),
);
if (
  process.env["GRANTTRACE_PROOF_MODE"] !== "1" ||
  !Number.isSafeInteger(issueNumber) ||
  issueNumber <= 0
) {
  throw new Error("The disposable proof scenario is not configured safely.");
}

const octokit = new Octokit({ auth: token });
let commentId: number | null = null;

try {
  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner,
      repo: repository,
      issue_number: issueNumber,
      body:
        "Temporary GrantTrace verification comment. It should be removed automatically; if it remains, verification cleanup failed.",
    },
  );
  commentId = response.data.id;
  if (!Number.isSafeInteger(commentId) || commentId <= 0) {
    throw new Error("GitHub returned an invalid comment identifier.");
  }
} finally {
  if (commentId !== null) {
    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
      {
        owner,
        repo: repository,
        comment_id: commentId,
      },
    );
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error("The disposable proof scenario is not configured safely.");
  }
  return value;
}
