import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, posix, relative } from "node:path";

import { projectRoot } from "./lib/project.mjs";

const exportRoot = join(projectRoot, "website", "out");
const deploymentBasePath = "/GrantTrace";
const files = await listFiles(exportRoot);
const relativeFiles = new Set(
  files.map((path) => relative(exportRoot, path).replaceAll("\\", "/")),
);
const errors = [];

for (const path of files) {
  const extension = extname(path);
  if (![".html", ".md", ".txt"].includes(extension)) {
    continue;
  }
  const content = await readFile(path, "utf8");
  const displayPath = relative(exportRoot, path).replaceAll("\\", "/");

  if (extension === ".html") {
    for (const match of content.matchAll(/\bhref="([^"]+)"/gu)) {
      validateLink(match[1], displayPath);
    }
    for (const match of content.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/giu)) {
      validateImage(match[1], displayPath);
    }
  }

  if (extension === ".md" || extension === ".txt") {
    if (/<\/?(?:Callout|Card|Cards|Step|Steps)\b/gu.test(content)) {
      errors.push(`${displayPath} contains unprocessed MDX UI components.`);
    }
    for (const match of content.matchAll(/\]\(([^)]+)\)/gu)) {
      validateLink(match[1], displayPath);
    }
  }
}

for (const required of [
  "llms.txt",
  "llms-full.txt",
  "llms.mdx/docs/content.md",
]) {
  if (!relativeFiles.has(required)) {
    errors.push(`Missing exported documentation artifact: ${required}.`);
  }
}

if (errors.length > 0) {
  console.error("Documentation export validation failed:");
  for (const error of [...new Set(errors)].sort()) {
    console.error(`  ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Documentation export validation passed: ${String(relativeFiles.size)} files checked.`,
  );
}

function validateLink(link, source) {
  if (
    link.startsWith("#") ||
    link.startsWith("mailto:") ||
    link.startsWith("https://") ||
    link.startsWith("http://")
  ) {
    if (/^https:\/\/toxfied\.github\.io\/docs(?:\/|$)/u.test(link)) {
      errors.push(`${source} omits the ${deploymentBasePath} Pages base path.`);
    }
    return;
  }
  if (/^\/docs(?:\/|$)/u.test(link)) {
    errors.push(`${source} links to ${link} without the Pages base path.`);
    return;
  }
  if (!link.startsWith(`${deploymentBasePath}/`) && link !== deploymentBasePath) {
    if (/\.(?:md|mdx)(?:#.*)?$/iu.test(link)) {
      errors.push(`${source} contains source-relative documentation link ${link}.`);
    }
    return;
  }

  const withoutFragment = link.split(/[?#]/u, 1)[0];
  if (withoutFragment === undefined) {
    return;
  }
  if (
    /\.mdx?(?:$|#)/iu.test(withoutFragment) &&
    !/^\/GrantTrace\/llms\.mdx\/docs\/(?:.*\/)?content\.md$/u.test(
      withoutFragment,
    )
  ) {
    errors.push(`${source} contains source documentation link ${link}.`);
    return;
  }

  const relativeTarget = withoutFragment
    .slice(deploymentBasePath.length)
    .replace(/^\/+/u, "");
  const target =
    relativeTarget.length === 0
      ? "index.html"
      : extname(relativeTarget).length > 0
        ? relativeTarget
        : `${relativeTarget.replace(/\/?$/u, "/")}index.html`;
  if (!relativeFiles.has(target)) {
    errors.push(`${source} links to missing exported target ${link}.`);
  }
}

function validateImage(image, source) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(image)) {
    return;
  }

  const withoutQuery = image.split(/[?#]/u, 1)[0];
  if (withoutQuery === undefined) {
    return;
  }

  let target;
  if (withoutQuery.startsWith("/")) {
    if (!withoutQuery.startsWith(`${deploymentBasePath}/`)) {
      errors.push(
        `${source} loads image ${image} without the ${deploymentBasePath} Pages base path.`,
      );
      return;
    }
    target = withoutQuery
      .slice(deploymentBasePath.length)
      .replace(/^\/+/u, "");
  } else {
    target = posix.normalize(posix.join(posix.dirname(source), withoutQuery));
  }

  if (!relativeFiles.has(target)) {
    errors.push(`${source} loads missing exported image ${image}.`);
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listFiles(path);
      }
      if (!entry.isFile() || !(await stat(path)).isFile()) {
        return [];
      }
      return [path];
    }),
  );
  return nested.flat();
}
