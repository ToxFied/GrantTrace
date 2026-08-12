import { lstat } from "node:fs/promises";
import { basename, resolve } from "node:path";

const MAX_PACKAGE_TARBALL_BYTES = 25 * 1024 * 1024;

export function parseSinglePackageArtifact(args) {
  if (args.length === 0) {
    return undefined;
  }
  if (
    args.length !== 2 ||
    args[0] !== "--artifact" ||
    typeof args[1] !== "string" ||
    args[1].length === 0
  ) {
    throw new Error("Usage: --artifact <package.tgz>");
  }
  return args[1];
}

export function parsePackageArtifacts(args) {
  if (args.length === 0) {
    return [];
  }
  if (args[0] === "--artifact") {
    return [parseSinglePackageArtifact(args)];
  }
  if (
    args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length === 0 ||
        argument.startsWith("-"),
    )
  ) {
    throw new Error("Usage: --artifact <package.tgz>");
  }
  return args;
}

export async function resolvePackageArtifact(path, cwd = process.cwd()) {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("The package artifact path is invalid.");
  }
  const absolutePath = resolve(cwd, path);
  const filename = basename(absolutePath);
  if (filename.length <= ".tgz".length || !filename.endsWith(".tgz")) {
    throw new Error("The package artifact must be a .tgz file.");
  }
  const details = await lstat(absolutePath);
  if (
    !details.isFile() ||
    details.size === 0 ||
    details.size > MAX_PACKAGE_TARBALL_BYTES
  ) {
    throw new Error("The package artifact is not a safe regular file.");
  }
  return absolutePath;
}
