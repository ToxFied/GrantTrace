import { describe, expect, it } from "vitest";

import { parseScenarioCommand } from "../../src/cli/scenario-command.js";

describe("scenario command arguments", () => {
  it("accepts the scenario as the first positional argument", () => {
    expect(
      parseScenarioCommand(
        ["issue-triage", "--timeout", "5m", "--", "pnpm", "test"],
        60 * 60 * 1_000,
      ),
    ).toEqual({
      success: true,
      value: {
        scenario: "issue-triage",
        command: "pnpm",
        commandArgs: ["test"],
        timeoutMs: 5 * 60 * 1_000,
      },
    });
  });

  it("keeps --scenario as a backwards-compatible spelling", () => {
    expect(
      parseScenarioCommand(
        ["--scenario", "issue-triage", "--", "pnpm", "test"],
        60 * 60 * 1_000,
      ),
    ).toMatchObject({
      success: true,
      value: { scenario: "issue-triage" },
    });
  });

  it("rejects ambiguous duplicate scenario names", () => {
    expect(
      parseScenarioCommand(
        ["issue-triage", "--scenario", "other", "--", "pnpm", "test"],
        60 * 60 * 1_000,
      ),
    ).toEqual({
      success: false,
      message: "Provide exactly one scenario name.",
    });
  });
});
