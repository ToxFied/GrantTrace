import { appendObservation } from "../contract/observation-file.js";
import type { Observation } from "../contract/observation.js";
import type { RecorderConfig } from "../octokit/config.js";
import {
  parseAcceptedPermissionsHeader,
  PermissionEvidenceError,
} from "../permissions/header.js";
import {
  ApiVersionMismatchError,
  RecorderPersistenceError,
} from "../recorder/errors.js";
import { isAutomaticCaptureSuppressed } from "../recorder/suppression.js";
import { markRecorderLoaded } from "../recorder/state.js";
import { GITHUB_API_VERSION } from "../version.js";
import {
  resolvePermissionBearingRoute,
  resolveRuntimeRoute,
  type RuntimeRouteResolution,
} from "./route.js";

type FetchTarget = {
  fetch: typeof globalThis.fetch;
};

export function installFetchRecorder(
  config: RecorderConfig,
  target: FetchTarget = globalThis,
): () => void {
  const originalFetch = target.fetch;
  let writeQueue: Promise<void> = Promise.resolve();

  markRecorderLoaded(config);

  const instrumentedFetch = async function grantTraceFetch(
    this: unknown,
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    if (isAutomaticCaptureSuppressed()) {
      return originalFetch.call(this, input, init);
    }

    const method = effectiveMethod(input, init);
    const resolution = resolveRuntimeRoute(method, input);
    if (resolution.kind === "ignored") {
      const response = await originalFetch.call(this, input, init);
      const permissionHeader = response.headers.get(
        "x-accepted-github-permissions",
      );
      if (permissionHeader === null) {
        return response;
      }
      const permissionBearingRoute = resolvePermissionBearingRoute(
        method,
        input,
      );
      if (
        permissionBearingRoute === null ||
        permissionBearingRoute.kind !== "resolved"
      ) {
        return response;
      }
      const observation = createRuntimeObservation(
        config,
        permissionBearingRoute,
        response.status,
        permissionHeader,
      );
      writeQueue = queueObservation(writeQueue, config, observation);
      await writeQueue;
      return response;
    }

    const pinnedInit =
      resolution.kind === "unresolved" &&
      resolution.reason === "unsupported_api"
        ? init
        : withPinnedApiVersion(input, init);
    try {
      const response = await originalFetch.call(this, input, pinnedInit);
      const observation = createRuntimeObservation(
        config,
        resolution,
        response.status,
        response.headers.get("x-accepted-github-permissions"),
      );
      writeQueue = queueObservation(writeQueue, config, observation);
      await writeQueue;
      return response;
    } catch (error) {
      if (
        error instanceof RecorderPersistenceError ||
        error instanceof ApiVersionMismatchError
      ) {
        throw error;
      }
      const observation = createRuntimeObservation(
        config,
        resolution,
        null,
        null,
      );
      writeQueue = queueObservation(writeQueue, config, observation);
      await writeQueue;
      throw error;
    }
  };
  target.fetch = instrumentedFetch;

  return () => {
    if (target.fetch === instrumentedFetch) {
      target.fetch = originalFetch;
    }
  };
}

function effectiveMethod(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): string {
  if (init?.method !== undefined) {
    return init.method;
  }
  return input instanceof Request ? input.method : "GET";
}

function withPinnedApiVersion(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): RequestInit {
  const inheritedHeaders =
    init?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(inheritedHeaders);
  const configured = headers.get("x-github-api-version");
  if (
    configured !== null &&
    configured.trim() !== GITHUB_API_VERSION
  ) {
    throw new ApiVersionMismatchError();
  }
  headers.set("x-github-api-version", GITHUB_API_VERSION);
  return { ...init, headers };
}

function createRuntimeObservation(
  config: RecorderConfig,
  resolution: Exclude<RuntimeRouteResolution, { kind: "ignored" }>,
  status: number | null,
  permissionHeader: string | null,
): Observation {
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

  if (permissionHeader === null) {
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
      requirements: parseAcceptedPermissionsHeader(permissionHeader),
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
