import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const workflowDirectory = join(projectRoot, ".github", "workflows");
const workflowEntries = await readdir(workflowDirectory, {
  withFileTypes: true,
});
const errors = [];
const expectedWorkflows = ["ci.yml", "docs-pages.yml"];
const workflowNames = workflowEntries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();
if (
  workflowEntries.some((entry) => !entry.isFile()) ||
  workflowNames.length !== expectedWorkflows.length ||
  workflowNames.some((name, index) => name !== expectedWorkflows[index])
) {
  errors.push("GitHub Actions workflows must be exactly ci.yml and docs-pages.yml.");
}

const workflowPath = join(workflowDirectory, "ci.yml");
const workflow = await readFile(workflowPath, "utf8");
const docsWorkflow = await readFile(
  join(workflowDirectory, "docs-pages.yml"),
  "utf8",
);
if (Buffer.byteLength(workflow, "utf8") > 256 * 1024) {
  throw new Error("CI workflow exceeds the reviewable size limit.");
}

const lines = workflow.split(/\r?\n/u);
const active = lines
  .map((line) => line.replace(/\s+#.*$/u, ""))
  .join("\n");

requireMatch(/^on:\s*$/mu, "CI must declare explicit triggers.");
requireMatch(/^\s{2}push:\s*$/mu, "CI must run for pushes.");
requireMatch(/^\s{2}pull_request:\s*$/mu, "CI must run for pull requests.");
rejectMatch(
  /^\s*pull_request_target\s*:/mu,
  "pull_request_target is forbidden.",
);
rejectMatch(/^\s*workflow_run\s*:/mu, "workflow_run is forbidden.");
rejectMatch(/^\s*deployment_status\s*:/mu, "deployment triggers are forbidden.");

validatePermissions();
validateJobs();
validateMatrix();
validateActions();
validateRequiredCommands();
validateForbiddenCapabilities();
validateDocumentationWorkflow(docsWorkflow);

if (errors.length > 0) {
  console.error("CI validation failed:");
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  process.exitCode = 1;
} else {
    console.log(
      "CI validation passed: package verification is offline; documentation deployment is pinned and least-privileged.",
    );
}

function validatePermissions() {
  const permissionHeaders = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s*permissions:\s*$/u.test(line));
  if (
    permissionHeaders.length !== 1 ||
    permissionHeaders[0]?.line !== "permissions:"
  ) {
    errors.push("CI must have one top-level permissions block.");
    return;
  }

  const start = permissionHeaders[0].index + 1;
  const entries = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) {
      continue;
    }
    if (!line.startsWith(" ")) {
      break;
    }
    const match = /^\s{2}([a-z-]+):\s*([a-z]+)\s*$/u.exec(line);
    if (match !== null) {
      entries.push(`${match[1]}:${match[2]}`);
    }
  }
  if (entries.length !== 1 || entries[0] !== "contents:read") {
    errors.push("CI permissions must be exactly contents: read.");
  }
}

function validateJobs() {
  const jobsLine = lines.findIndex((line) => line === "jobs:");
  const jobIds =
    jobsLine < 0
      ? []
      : lines
          .slice(jobsLine + 1)
          .map((line) => /^  ([a-z][a-z0-9-]*):\s*$/u.exec(line)?.[1])
          .filter((value) => value !== undefined);
  if (
    jobIds.length !== 2 ||
    jobIds[0] !== "verify" ||
    jobIds[1] !== "package-portability"
  ) {
    errors.push("CI jobs must be exactly verify and package-portability.");
  }
  if (
    lines.filter((line) => /^\s+runs-on:\s*ubuntu-latest\s*$/u.test(line))
      .length !== 1
  ) {
    errors.push("The full verification job must run once on Ubuntu.");
  }
}

function validateMatrix() {
  requireMatch(
    /^\s{4}strategy:\s*\n\s{6}fail-fast:\s*false\s*\n\s{6}matrix:\s*\n\s{8}os:\s*\[macos-latest,\s*windows-latest\]\s*$/mu,
    "Package portability must use the exact macOS and Windows matrix.",
  );
  const runsOnExpressions = lines.filter((line) =>
    /^\s+runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}\s*$/u.test(line),
  );
  if (runsOnExpressions.length !== 1) {
    errors.push("CI must use matrix.os exactly once for package portability.");
  }
  const expressions = active.match(/\$\{\{[\s\S]*?\}\}/gu) ?? [];
  if (
    expressions.length !== 1 ||
    expressions[0]?.replace(/\s/gu, "") !== "${{matrix.os}}"
  ) {
    errors.push("Only the matrix.os GitHub expression is allowed.");
  }
}

function validateActions() {
  const uses = [];
  for (const line of lines) {
    const match = /^\s+uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(line);
    if (match !== null) {
      uses.push(match[1]);
    }
  }
  if (uses.length === 0) {
    errors.push("CI must use pinned checkout and Node setup Actions.");
    return;
  }

  for (const action of uses) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u.test(action)) {
      errors.push(`Action ${action.split("@")[0]} is not pinned to a full SHA.`);
    }
    if (
      !action.startsWith("actions/checkout@") &&
      !action.startsWith("actions/setup-node@")
    ) {
      errors.push(`Action ${action.split("@")[0]} is outside the CI allowlist.`);
    }
  }
  if (uses.length !== 4) {
    errors.push(
      "Each CI job must use only checkout and Node setup Actions.",
    );
  }
  for (const required of ["actions/checkout", "actions/setup-node"]) {
    if (
      uses.filter((action) => action.startsWith(`${required}@`)).length !== 2
    ) {
      errors.push(`CI must use ${required} exactly once per job.`);
    }
  }

  const checkoutLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s+uses:\s*actions\/checkout@/u.test(line));
  for (const checkout of checkoutLines) {
    const block = stepBlock(checkout.index).join("\n");
    if (!/^\s+persist-credentials:\s*false\s*$/mu.test(block)) {
      errors.push("Every checkout must disable persisted credentials.");
    }
  }

  const nodeLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s+uses:\s*actions\/setup-node@/u.test(line));
  for (const node of nodeLines) {
    const block = stepBlock(node.index).join("\n");
    if (!/^\s+node-version:\s*["']?22["']?\s*$/mu.test(block)) {
      errors.push("Every CI job must run on Node 22.");
    }
    if (/^\s+cache\s*:/mu.test(block)) {
      errors.push("Dependency caching is intentionally disabled.");
    }
  }
}

function validateRequiredCommands() {
  const required = new Map([
    ["corepack enable", ["enable the pinned package manager", 2]],
    ["pnpm install --frozen-lockfile", ["install the frozen lockfile", 2]],
    ["pnpm verify", "run the full offline verification"],
    ["pnpm audit --prod", "audit production dependencies"],
    ["pnpm package:smoke", ["smoke-test the tarball", 2]],
    ["pnpm leakage:scan", "scan for leakage"],
    ["git diff --check", "check patch whitespace"],
  ]);
  const commands = lines
    .map((line) => /^\s+run:\s*(.+?)\s*$/u.exec(line)?.[1])
    .filter((value) => value !== undefined);
  for (const command of commands) {
    if (!required.has(command)) {
      errors.push("CI contains a run command outside the offline allowlist.");
    }
  }
  for (const [command, requirement] of required) {
    const [description, count] = Array.isArray(requirement)
      ? requirement
      : [requirement, 1];
    if (
      commands.filter((candidate) => candidate === command).length !== count
    ) {
      errors.push(
        `CI must ${description} ${
          count === 1 ? "exactly once" : `exactly ${String(count)} times`
        }.`,
      );
    }
  }
  const timeouts = lines.filter((line) =>
    /^\s+timeout-minutes:\s*(?:[1-9]|[12]\d|30)\s*$/u.test(line),
  );
  if (timeouts.length !== 2) {
    errors.push("Every CI job needs a timeout of at most 30 minutes.");
  }
}

function validateForbiddenCapabilities() {
  for (const [pattern, description] of [
    [/\bsecrets\s*(?:\.|\[)/iu, "workflow secrets"],
    [/\$\{\{\s*github\.token\s*\}\}/iu, "the GitHub token"],
    [/\bGITHUB_TOKEN\b/u, "the GitHub token"],
    [
      /\bGRANTTRACE_(?:APP|INSTALLATION|LIVE|PRIVATE|KEY)[A-Z0-9_]*\b/u,
      "live fixture configuration",
    ],
    [/\bgranttrace\s+prove\b/u, "live proof"],
    [/\bactions\/(?:upload|download)-artifact@/u, "artifact transfer"],
    [/\bactions\/cache@/u, "dependency caching"],
    [/\bcontinue-on-error:\s*true\b/u, "ignored failures"],
    [/\b(?:npm|pnpm)\s+publish\b/u, "package publishing"],
    [/\bgh\s+release\b/u, "release publishing"],
    [/\b(?:deploy|pages)\b/iu, "deployment"],
  ]) {
    if (pattern.test(active)) {
      errors.push(`CI must not use ${description}.`);
    }
  }
}

function validateDocumentationWorkflow(content) {
  if (Buffer.byteLength(content, "utf8") > 256 * 1024) {
    errors.push("Documentation workflow exceeds the reviewable size limit.");
    return;
  }
  const docsActive = content
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+#.*$/u, ""))
    .join("\n");

  for (const [pattern, message] of [
    [/^\s{2}push:\s*$/mu, "Documentation deployment must run for pushes."],
    [/^\s{4}branches:\s*\[main\]\s*$/mu, "Documentation deployment must target main."],
    [/^\s{2}workflow_dispatch:\s*$/mu, "Documentation deployment must support manual dispatch."],
    [/^\s{2}contents:\s*read\s*$/mu, "Documentation deployment needs contents: read."],
    [/^\s{2}pages:\s*write\s*$/mu, "Documentation deployment needs pages: write."],
    [/^\s{2}id-token:\s*write\s*$/mu, "Documentation deployment needs id-token: write."],
    [/^\s+run:\s*pnpm docs:typecheck\s*$/mu, "Documentation deployment must typecheck the site."],
    [/^\s+run:\s*pnpm docs:build\s*$/mu, "Documentation deployment must build the site."],
    [/^\s+run:\s*pnpm docs:validate\s*$/mu, "Documentation deployment must validate the export."],
  ]) {
    if (!pattern.test(docsActive)) {
      errors.push(message);
    }
  }

  for (const [pattern, description] of [
    [/^\s*pull_request_target\s*:/mu, "pull_request_target"],
    [/\bsecrets\s*(?:\.|\[)/iu, "workflow secrets"],
    [/\bgranttrace\s+prove\b/iu, "live proof"],
    [/\b(?:npm|pnpm)\s+publish\b/iu, "package publishing"],
  ]) {
    if (pattern.test(docsActive)) {
      errors.push(`Documentation deployment must not use ${description}.`);
    }
  }

  const allowedActions = [
    "actions/checkout",
    "actions/configure-pages",
    "actions/deploy-pages",
    "actions/setup-node",
    "actions/upload-pages-artifact",
  ];
  const actions = [
    ...content.matchAll(/^\s+uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu),
  ].map((match) => match[1]);
  for (const action of actions) {
    if (
      action === undefined ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/u.test(action)
    ) {
      errors.push("Every documentation Action must be pinned to a full SHA.");
      continue;
    }
    if (!allowedActions.some((name) => action.startsWith(`${name}@`))) {
      errors.push(
        `Documentation Action ${action.split("@")[0]} is outside the allowlist.`,
      );
    }
  }
  if (actions.length !== allowedActions.length) {
    errors.push("Documentation deployment must use the five reviewed Actions.");
  }
}

function stepBlock(start) {
  const block = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || /^\s{6}-\s+/u.test(line)) {
      break;
    }
    block.push(line);
  }
  return block;
}

function requireMatch(pattern, message) {
  if (!pattern.test(active)) {
    errors.push(message);
  }
}

function rejectMatch(pattern, message) {
  if (pattern.test(active)) {
    errors.push(message);
  }
}
