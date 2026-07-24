import { AsyncLocalStorage } from "node:async_hooks";

const automaticCapture = new AsyncLocalStorage<boolean>();

export function isAutomaticCaptureSuppressed(): boolean {
  return automaticCapture.getStore() === true;
}

export function withoutAutomaticCapture<T>(
  operation: () => T,
): T {
  return automaticCapture.run(true, operation);
}
