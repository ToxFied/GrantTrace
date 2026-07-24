import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function npmInvocation() {
  const executableDirectory = dirname(process.execPath);
  const prefixDirectory = dirname(executableDirectory);
  const cli = await firstRegularFile([
    join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    join(
      prefixDirectory,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ]);
  if (cli === null) {
    throw new Error("The npm CLI bundled with Node.js could not be located.");
  }
  return { command: process.execPath, prefixArgs: [cli] };
}

export async function pnpmInvocation() {
  const configured = process.env.npm_execpath;
  if (
    configured !== undefined &&
    /(?:^|[\\/])pnpm(?:\.c?js)?$/iu.test(configured) &&
    (await isRegularFile(configured))
  ) {
    return { command: process.execPath, prefixArgs: [configured] };
  }

  const executableDirectory = dirname(process.execPath);
  const corepack = await firstRegularFile([
    join(executableDirectory, "corepack"),
    join(executableDirectory, "node_modules", "corepack", "dist", "corepack.js"),
  ]);
  if (corepack === null) {
    throw new Error("The Corepack CLI bundled with Node.js could not be located.");
  }
  return {
    command: process.execPath,
    prefixArgs: [corepack, "pnpm"],
  };
}

export function invocationArgs(invocation, args) {
  return [...invocation.prefixArgs, ...args];
}

async function firstRegularFile(candidates) {
  for (const candidate of candidates) {
    if (await isRegularFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
