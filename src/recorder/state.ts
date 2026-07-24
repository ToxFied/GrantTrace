import { writeFileSync } from "node:fs";

import type { RecorderConfig } from "../octokit/config.js";
import { RecorderPersistenceError } from "./errors.js";

export function markRecorderLoaded(config: RecorderConfig): void {
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
