import { Octokit } from "@octokit/core";

import { grantTrace } from "../../../src/octokit/plugin.js";

const TracedOctokit = Octokit.plugin(grantTrace);
void new TracedOctokit();
