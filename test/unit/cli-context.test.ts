import { describe, expect, it } from "vitest";

import { styleCliOutput } from "../../src/cli/context.js";

const reset = "\u001b[0m";
const bold = "\u001b[1m";
const cyan = "\u001b[36m";
const green = "\u001b[32m";
const red = "\u001b[31m";
const yellow = "\u001b[33m";

describe("interactive CLI styling", () => {
  it("styles stable semantic lines without changing their plain text", () => {
    const plain = [
      "GrantTrace check passed",
      "GrantTrace contract accepted",
      "GrantTrace record complete",
      "GrantTrace recording started",
      "GrantTrace check failed",
      "GrantTrace record blocked",
      "GrantTrace record interrupted",
      "GrantTrace record timed out",
      "GrantTrace contract review required",
      "Decision",
      "Next",
      "Coverage",
      "Observed in",
      "Selected permission contract",
      "Observed permission contract",
      "Mandatory GitHub baseline (not selected or manually kept)",
      "  issues: write",
      "  granttrace check --accept",
      "Unstyled detail",
      "",
    ].join("\n");

    const styled = styleCliOutput(plain);

    expect(styled).toContain(`${bold}${green}GrantTrace check passed${reset}`);
    expect(styled).toContain(`${bold}${red}GrantTrace check failed${reset}`);
    expect(styled).toContain(
      `${bold}${yellow}GrantTrace contract review required${reset}`,
    );
    expect(styled).toContain(`${bold}${cyan}Decision${reset}`);
    expect(styled).toContain(`${green}  issues: write${reset}`);
    expect(styled).toContain(`${bold}  granttrace check --accept${reset}`);
    expect(styled).toContain("Unstyled detail");
    expect(stripAnsi(styled)).toBe(plain);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, "");
}
