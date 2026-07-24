import { Octokit } from "@octokit/core";
import { grantTrace } from "./plugin.js";

export {
  ApiVersionMismatchError,
  createGrantTracePlugin,
  grantTrace,
  RecorderPersistenceError,
} from "./plugin.js";
export { createRecorderConfig } from "./config.js";

export const GrantTraceOctokit = Octokit.plugin(grantTrace);
