import { writeFileSync } from "node:fs";

import type { Octokit } from "@octokit/core";

import {
  appendObservation,
} from "../contract/observation-file.js";
import type { Observation } from "../contract/observation.js";
import {
  parseAcceptedPermissionsHeader,
  PermissionEvidenceError,
} from "../permissions/header.js";
import { resolveSafeRoute } from "../routes/canonical.js";
import {
  loadRecorderConfig,
  type RecorderConfig,
} from "./config.js";
import { GITHUB_API_VERSION } from "../version.js";

type RequestResponse = {
  status: number;
  headers: Record<string, unknown>;
};

export class RecorderPersistenceError extends Error {
  public constructor() {
    super("GrantTrace could not persist a safe observation.");
    this.name = "RecorderPersistenceError";
  }
}

export class ApiVersionMismatchError extends Error {
  public constructor() {
    super(
      `GrantTrace recording requires GitHub REST API version ${GITHUB_API_VERSION}.`,
    );
    this.name = "ApiVersionMismatchError";
  }
}

export function grantTrace(octokit: Octokit): void {
  const config = loadRecorderConfig(process.env);
  if (config === null) {
    return;
  }

  installRecorder(octokit, config);
}

export function createGrantTracePlugin(config: RecorderConfig) {
  let writeQueue: Promise<void> = Promise.resolve();

  return function configuredGrantTrace(octokit: Octokit): void {
    markPluginLoaded(config);

    octokit.hook.wrap("request", async (request, options) => {
      pinApiVersion(options.headers);
      try {
        const response = await request(options);
        const observation = createObservation(
          config,
          options.method,
          options.url,
          asResponse(response),
        );
        writeQueue = queueObservation(writeQueue, config, observation);
        await writeQueue;
        return response;
      } catch (error) {
        if (error instanceof RecorderPersistenceError) {
          throw error;
        }

        const observation = createObservation(
          config,
          options.method,
          options.url,
          responseFromError(error),
        );
        writeQueue = queueObservation(writeQueue, config, observation);
        await writeQueue;
        throw error;
      }
    });
  };
}

function pinApiVersion(headers: Record<string, string | number | undefined>): void {
  const configured = headers["x-github-api-version"];
  if (
    configured !== undefined &&
    String(configured) !== GITHUB_API_VERSION
  ) {
    throw new ApiVersionMismatchError();
  }
  headers["x-github-api-version"] = GITHUB_API_VERSION;
}

function installRecorder(octokit: Octokit, config: RecorderConfig): void {
  createGrantTracePlugin(config)(octokit);
}

function markPluginLoaded(config: RecorderConfig): void {
  try {
    writeFileSync(config.markerFile, "loaded\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "EEXIST"
    ) {
      throw new RecorderPersistenceError();
    }
  }
}

function createObservation(
  config: RecorderConfig,
  methodInput: unknown,
  urlInput: unknown,
  response: RequestResponse | null,
): Observation {
  const resolution = resolveSafeRoute(
    methodInput,
    urlInput,
    config.catalog,
  );
  const status = response?.status ?? null;

  if (resolution.kind === "unresolved") {
    return {
      schemaVersion: 1,
      scenario: config.scenario,
      method: resolution.method as Observation["method"],
      routeTemplate: null,
      status,
      requirements: null,
      evidenceSource: "none",
      finding: resolution.reason,
    };
  }

  const header = acceptedPermissionsHeader(response);
  if (header === null) {
    return {
      schemaVersion: 1,
      scenario: config.scenario,
      method: resolution.route.method as Observation["method"],
      routeTemplate: resolution.route.template,
      status,
      requirements: null,
      evidenceSource: "none",
      finding: "missing_evidence",
    };
  }

  try {
    return {
      schemaVersion: 1,
      scenario: config.scenario,
      method: resolution.route.method as Observation["method"],
      routeTemplate: resolution.route.template,
      status,
      requirements: parseAcceptedPermissionsHeader(header),
      evidenceSource: "runtime_header",
      finding: null,
    };
  } catch (error) {
    if (!(error instanceof PermissionEvidenceError)) {
      throw error;
    }

    return {
      schemaVersion: 1,
      scenario: config.scenario,
      method: resolution.route.method as Observation["method"],
      routeTemplate: resolution.route.template,
      status,
      requirements: null,
      evidenceSource: "none",
      finding: "malformed_header",
    };
  }
}

function acceptedPermissionsHeader(
  response: RequestResponse | null,
): string | null {
  if (response === null) {
    return null;
  }

  const value = response.headers["x-accepted-github-permissions"];
  return typeof value === "string" ? value : null;
}

function asResponse(value: unknown): RequestResponse | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    !("headers" in value)
  ) {
    return null;
  }

  const status = value.status;
  const headers = value.headers;
  if (
    typeof status !== "number" ||
    typeof headers !== "object" ||
    headers === null
  ) {
    return null;
  }

  return { status, headers: headers as Record<string, unknown> };
}

function responseFromError(error: unknown): RequestResponse | null {
  if (
    typeof error !== "object" ||
    error === null ||
    !("response" in error)
  ) {
    return null;
  }
  return asResponse(error.response);
}

async function queueObservation(
  previous: Promise<void>,
  config: RecorderConfig,
  observation: Observation,
): Promise<void> {
  try {
    await previous;
    await appendObservation(config.observationsFile, observation);
  } catch {
    throw new RecorderPersistenceError();
  }
}
