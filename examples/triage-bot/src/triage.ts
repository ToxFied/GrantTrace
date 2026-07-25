export type IssueReference = {
  owner: string;
  repository: string;
  issueNumber: number;
};

export type GitHubRequest = <Result>(
  route: string,
  parameters: Record<string, unknown>,
) => Promise<Result>;

export async function postTriageComment(
  request: GitHubRequest,
  issue: IssueReference,
): Promise<number> {
  const result = await request<{ id: number }>(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: issue.owner,
      repo: issue.repository,
      issue_number: issue.issueNumber,
      body: "Thanks for the report. A maintainer has added it to the triage queue.",
    },
  );

  if (!Number.isSafeInteger(result.id) || result.id <= 0) {
    throw new Error("GitHub returned an invalid comment identifier.");
  }
  return result.id;
}
