import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { projectRoot, readPackageManifest } from "./lib/project.mjs";

await readPackageManifest();

const workflowPath = join(projectRoot, ".github", "workflows", "ci.yml");
const workflow = await readFile(workflowPath, "utf8");
if (Buffer.byteLength(workflow, "utf8") > 256 * 1024) {
  throw new Error("CI workflow exceeds the reviewable size limit.");
}

const errors = [];
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
validateActions();
validateRequiredCommands();
validateForbiddenCapabilities();

if (errors.length > 0) {
  console.error("CI validation failed:");
  for (const error of errors) {
    console.error(`  ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("CI validation passed: offline, pinned, and least-privileged.");
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
  if (uses.length !== 2) {
    errors.push("CI may use only checkout and Node setup Actions.");
  }
  for (const required of ["actions/checkout", "actions/setup-node"]) {
    if (!uses.some((action) => action.startsWith(`${required}@`))) {
      errors.push(`CI is missing ${required}.`);
    }
  }

  const checkoutLine = lines.findIndex((line) =>
    /^\s+uses:\s*actions\/checkout@/u.test(line),
  );
  const checkoutBlock =
    checkoutLine < 0 ? "" : stepBlock(checkoutLine).join("\n");
  if (!/^\s+persist-credentials:\s*false\s*$/mu.test(checkoutBlock)) {
    errors.push("Checkout must disable persisted credentials.");
  }

  const nodeLine = lines.findIndex((line) =>
    /^\s+uses:\s*actions\/setup-node@/u.test(line),
  );
  const nodeBlock = nodeLine < 0 ? "" : stepBlock(nodeLine).join("\n");
  if (!/^\s+node-version:\s*["']?22["']?\s*$/mu.test(nodeBlock)) {
    errors.push("CI must run on Node 22.");
  }
  if (/^\s+cache\s*:/mu.test(nodeBlock)) {
    errors.push("Dependency caching is intentionally disabled.");
  }
}

function validateRequiredCommands() {
  const required = new Map([
    ["corepack enable", "enable the pinned package manager"],
    ["pnpm install --frozen-lockfile", "install the frozen lockfile"],
    ["pnpm verify", "run the full offline verification"],
    ["pnpm audit --prod", "audit production dependencies"],
    ["pnpm package:smoke", "smoke-test the tarball"],
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
  for (const [command, description] of required) {
    if (commands.filter((candidate) => candidate === command).length !== 1) {
      errors.push(`CI must ${description} exactly once.`);
    }
  }
  if (!/^\s+timeout-minutes:\s*(?:[1-9]|[12]\d|30)\s*$/mu.test(active)) {
    errors.push("CI jobs need a timeout of at most 30 minutes.");
  }
}

function validateForbiddenCapabilities() {
  for (const [pattern, description] of [
    [/\$\{\{/u, "GitHub expression contexts"],
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
