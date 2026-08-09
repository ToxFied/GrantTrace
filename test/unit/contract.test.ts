import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { buildContract } from "../../src/contract/build.js";
import { loadObservations } from "../../src/contract/observation-file.js";
import {
  ContractFileError,
  contractHash,
  serializeContract,
} from "../../src/contract/serialize.js";
import { fixtureCatalog } from "../../src/evidence/catalog.js";

const fixturePath = new URL(
  "../fixtures/observations/triage.ndjson",
  import.meta.url,
);

describe("deterministic contract", () => {
  it("selects issues:write for the current issue-comment alternatives", async () => {
    const observations = await loadObservations(fixturePath.pathname);
    const contract = buildContract(observations, fixtureCatalog);

    expect(contract.selectedPermissions).toEqual({ issues: "write" });
    expect(contract.routes).toHaveLength(1);
    expect(contract.routes[0]?.evidence).toEqual([
      "runtime_header",
      "pinned_catalog",
    ]);
    expect(contract.unknowns).toEqual([]);
  });

  it("accepts any complete frontier assignment as the selected policy", async () => {
    const observations = await loadObservations(fixturePath.pathname);
    const contract = buildContract(observations, fixtureCatalog);
    const selectedAlternative = {
      ...contract,
      selectedPermissions: { pull_requests: "write" as const },
    };

    expect(JSON.parse(serializeContract(selectedAlternative))).toMatchObject({
      schemaVersion: 3,
      selectedPermissions: { pull_requests: "write" },
    });
    expect(() =>
      serializeContract({
        ...contract,
        selectedPermissions: { contents: "read" },
      }),
    ).toThrow(ContractFileError);
  });

  it("is byte-identical for semantically identical reordered input", async () => {
    const observations = await loadObservations(fixturePath.pathname);
    const first = buildContract(observations, fixtureCatalog);
    const second = buildContract([...observations].reverse(), fixtureCatalog);

    expect(serializeContract(first)).toBe(serializeContract(second));
    expect(contractHash(first)).toBe(contractHash(second));
    expect(serializeContract(first).endsWith("\n")).toBe(true);
  });

  it("does not inherit source file text into the contract", async () => {
    const source = await readFile(fixturePath, "utf8");
    const observations = await loadObservations(fixturePath.pathname);
    const serialized = serializeContract(buildContract(observations, fixtureCatalog));

    expect(source).toContain("triage-integration");
    expect(serialized).not.toContain("\"status\"");
    expect(serialized).not.toContain("\"finding\": null");
  });
});
