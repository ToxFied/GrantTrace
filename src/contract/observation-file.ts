import {
  appendFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomBytes } from "node:crypto";

import { canonicalDNFKey, canonicalizeDNF } from "../permissions/canonical.js";
import { compareAscii } from "../deterministic.js";
import { ObservationSchema, type Observation } from "./observation.js";
import {
  BoundedFileError,
  readBoundedRegularFile,
} from "../security/bounded-file.js";

const MAX_OBSERVATION_BYTES = 10 * 1024 * 1024;
const MAX_OBSERVATIONS = 10_000;
const MAX_LINE_BYTES = 64 * 1024;

export class ObservationFileError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ObservationFileError";
  }
}

export async function appendObservation(
  path: string,
  observation: Observation,
): Promise<void> {
  const serialized = serializeObservation(observation);
  await appendFile(path, serialized, { encoding: "utf8", mode: 0o600 });
}

export async function loadObservations(path: string): Promise<Observation[]> {
  let content: string;
  try {
    content = (
      await readBoundedRegularFile(path, MAX_OBSERVATION_BYTES)
    ).toString("utf8");
  } catch (error) {
    if (error instanceof BoundedFileError && error.code === "too_large") {
      throw new ObservationFileError(
        "Observation file exceeds the size limit.",
      );
    }
    throw new ObservationFileError(
      isMissingFile(error)
        ? "Observation file does not exist."
        : "Observation file could not be read.",
    );
  }

  const lines = content.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length > MAX_OBSERVATIONS) {
    throw new ObservationFileError("Observation file has too many records.");
  }
  if (lines.length === 0) {
    return [];
  }

  return lines.map((line, index) => {
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
      throw new ObservationFileError(
        `Observation record ${index + 1} exceeds the size limit.`,
      );
    }

    try {
      return canonicalizeObservation(ObservationSchema.parse(JSON.parse(line)));
    } catch {
      throw new ObservationFileError(
        `Observation record ${index + 1} is invalid.`,
      );
    }
  });
}

export async function writeObservations(
  path: string,
  observations: Observation[],
): Promise<void> {
  const content = sortObservations(observations)
    .map(serializeObservation)
    .join("");
  const temporaryPath = `${path}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function serializeObservation(observation: Observation): string {
  const canonical = canonicalizeObservation(ObservationSchema.parse(observation));
  return `${JSON.stringify(canonical)}\n`;
}

export function sortObservations(
  observations: Observation[],
): Observation[] {
  return observations
    .map(canonicalizeObservation)
    .sort((left, right) =>
      compareAscii(observationKey(left), observationKey(right)),
    );
}

function canonicalizeObservation(observation: Observation): Observation {
  return {
    schemaVersion: 1,
    scenario: observation.scenario,
    method: observation.method,
    routeTemplate: observation.routeTemplate,
    status: observation.status,
    requirements:
      observation.requirements === null
        ? null
        : canonicalizeDNF(observation.requirements),
    evidenceSource: observation.evidenceSource,
    finding: observation.finding,
  };
}

function observationKey(observation: Observation): string {
  const requirements =
    observation.requirements === null
      ? ""
      : canonicalDNFKey(observation.requirements);
  return [
    observation.scenario,
    observation.method,
    observation.routeTemplate ?? "",
    String(observation.status ?? ""),
    requirements,
    observation.evidenceSource,
    observation.finding ?? "",
  ].join("\u0000");
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
