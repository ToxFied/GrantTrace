import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import { diffContracts } from "../../src/contract/diff.js";
import { loadObservations } from "../../src/contract/observation-file.js";
import { serializeContract } from "../../src/contract/serialize.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";
import {
  renderAnalysisReport,
  renderContractDiff,
} from "../../src/reporting/terminal.js";

const fixture = new URL(
  "../fixtures/observations/triage.ndjson",
  import.meta.url,
);

describe("golden output", () => {
  it("keeps contract and plain terminal output stable", async () => {
    const observations = await loadObservations(fixture.pathname);
    const contract = buildContract(observations, fixtureCatalog);
    const emptyPrevious = {
      ...contract,
      routes: [],
      selectedPermissions: {},
      permissionFrontier: [{}],
    };

    await expectGolden(
      "triage-contract.json",
      serializeContract(contract),
    );
    await expectGolden(
      "triage-analysis.txt",
      renderAnalysisReport(contract, observations.length),
    );
    await expectGolden(
      "new-permission-diff.txt",
      renderContractDiff(diffContracts(emptyPrevious, contract), contract),
    );
  });
});

async function expectGolden(name: string, actual: string): Promise<void> {
  const expected = await readFile(new URL(name, import.meta.url), "utf8");
  expect(actual).toBe(expected);
}
