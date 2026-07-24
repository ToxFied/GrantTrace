import { loadRecorderConfig } from "../octokit/config.js";
import { installFetchRecorder } from "./fetch-recorder.js";

const config = loadRecorderConfig(process.env);
if (config !== null) {
  installFetchRecorder(config);
}
