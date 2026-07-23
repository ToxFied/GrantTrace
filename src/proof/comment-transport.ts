import { Octokit } from "@octokit/core";

import { SensitiveValue } from "../security/sensitive-value.js";
import { GITHUB_API_VERSION } from "../version.js";
import type { FixtureCoordinates } from "./live-config.js";

export type CommentReference = {
  id: SensitiveValue;
};

export interface LiveCommentTransport {
  createComment(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
  }): Promise<CommentReference>;
  deleteComment(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
    comment: CommentReference;
  }): Promise<void>;
}

export class OctokitCommentTransport implements LiveCommentTransport {
  public async createComment(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
  }): Promise<CommentReference> {
    const octokit = new Octokit({ auth: input.token.reveal() });
    const response = await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner: input.fixture.owner,
        repo: input.fixture.repository,
        issue_number: Number(input.fixture.issueNumber),
        body: "GrantTrace disposable permission proof. This comment is deleted immediately.",
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
        },
      },
    );
    const id = response.data.id;
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("GitHub returned an invalid comment identifier.");
    }
    return { id: new SensitiveValue(String(id)) };
  }

  public async deleteComment(input: {
    token: SensitiveValue;
    fixture: FixtureCoordinates;
    comment: CommentReference;
  }): Promise<void> {
    const commentId = Number(input.comment.id.reveal());
    if (!Number.isSafeInteger(commentId) || commentId <= 0) {
      throw new Error("The comment identifier is invalid.");
    }
    const octokit = new Octokit({ auth: input.token.reveal() });
    await octokit.request(
      "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
      {
        owner: input.fixture.owner,
        repo: input.fixture.repository,
        comment_id: commentId,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": GITHUB_API_VERSION,
        },
      },
    );
  }
}
