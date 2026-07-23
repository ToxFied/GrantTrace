import type { ProofFailure } from "./failure.js";

export type CleanupExecutionResult<T> = {
  operation:
    | { status: "pass"; value: T }
    | { status: "failed"; failure: ProofFailure };
  cleanup:
    | { status: "pass" }
    | { status: "failed"; failure: "cleanup_failure" };
};

export async function executeWithCleanup<T>(
  operation: () => Promise<T>,
  cleanup: () => Promise<void>,
  classifyOperationFailure: (error: unknown) => ProofFailure,
): Promise<CleanupExecutionResult<T>> {
  let operationResult: CleanupExecutionResult<T>["operation"];
  try {
    operationResult = {
      status: "pass",
      value: await operation(),
    };
  } catch (error) {
    operationResult = {
      status: "failed",
      failure: classifyOperationFailure(error),
    };
  }

  let cleanupResult: CleanupExecutionResult<T>["cleanup"];
  try {
    await cleanup();
    cleanupResult = { status: "pass" };
  } catch {
    cleanupResult = {
      status: "failed",
      failure: "cleanup_failure",
    };
  }

  return {
    operation: operationResult,
    cleanup: cleanupResult,
  };
}
