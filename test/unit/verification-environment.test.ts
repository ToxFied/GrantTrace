import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface ProcessHelpers {
  portableEnvironment: () => Record<string, string>;
  portableTemporaryAcceptanceEnvironment: (
    environment?: Record<string, string>,
  ) => Record<string, string>;
}

const helpers = (await import(
  new URL("../../scripts/lib/process.mjs", import.meta.url).href
)) as ProcessHelpers;

describe("verification child environments", () => {
  it("keeps ordinary verification fail-closed in CI", () => {
    expect(helpers.portableEnvironment()["CI"]).toBe("1");
  });

  it("disables CI detection only for disposable contract acceptance", () => {
    const environment = helpers.portableTemporaryAcceptanceEnvironment({
      CI: "1",
      GITHUB_ACTIONS: "true",
      PATH: "/safe/bin",
    });

    expect(environment).toEqual({
      CI: "0",
      GITHUB_ACTIONS: "false",
      PATH: "/safe/bin",
    });
  });

  it("uses the narrow environment only at the two temporary acceptance sites", async () => {
    const root = process.cwd();
    const [reproduction, packageSmoke] = await Promise.all([
      readFile(join(root, "scripts", "reproduce-contract.mjs"), "utf8"),
      readFile(join(root, "scripts", "package-smoke.mjs"), "utf8"),
    ]);

    expect(reproduction).toContain(
      "environment: portableTemporaryAcceptanceEnvironment(),",
    );
    expect(packageSmoke).toContain(
      "environment: portableTemporaryAcceptanceEnvironment(environment),",
    );
    expect(
      `${reproduction}\n${packageSmoke}`.match(
        /environment: portableTemporaryAcceptanceEnvironment\(/gu,
      ),
    ).toHaveLength(2);
  });
});
