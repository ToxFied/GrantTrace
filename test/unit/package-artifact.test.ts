import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

interface PackageArtifactHelpers {
  parsePackageArtifacts: (args: string[]) => string[];
  parseSinglePackageArtifact: (args: string[]) => string | undefined;
  resolvePackageArtifact: (path: string, cwd?: string) => Promise<string>;
}

interface TarHelpers {
  readTarGzip: (archive: Buffer) => Array<{
    path: string;
    mode: number;
    content: Buffer;
  }>;
}

const {
  parsePackageArtifacts,
  parseSinglePackageArtifact,
  resolvePackageArtifact,
} = (await import(
  new URL("../../scripts/lib/package-artifact.mjs", import.meta.url).href
)) as PackageArtifactHelpers;
const { readTarGzip } = (await import(
  new URL("../../scripts/lib/tar.mjs", import.meta.url).href
)) as TarHelpers;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("release package artifact", () => {
  it("accepts only the explicit single-artifact flag", () => {
    expect(parseSinglePackageArtifact([])).toBeUndefined();
    expect(parseSinglePackageArtifact(["--artifact", "release.tgz"])).toBe(
      "release.tgz",
    );
    expect(parsePackageArtifacts(["--artifact", "release.tgz"])).toEqual([
      "release.tgz",
    ]);
    expect(parsePackageArtifacts(["first.tgz", "second.tgz"])).toEqual([
      "first.tgz",
      "second.tgz",
    ]);

    for (const args of [
      ["--artifact"],
      ["--artifact", "release.tgz", "extra.tgz"],
      ["--unknown", "release.tgz"],
    ]) {
      expect(() => parseSinglePackageArtifact(args)).toThrow();
    }
  });

  it("requires a bounded regular tgz file and rejects symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "granttrace-artifact-test-"));
    temporaryDirectories.push(directory);
    const artifact = join(directory, "release.tgz");
    const link = join(directory, "linked.tgz");
    await writeFile(artifact, "archive");
    await symlink(artifact, link);

    await expect(resolvePackageArtifact(artifact)).resolves.toBe(artifact);
    await expect(resolvePackageArtifact(link)).rejects.toThrow(
      "safe regular file",
    );
    await expect(
      resolvePackageArtifact(join(directory, "release.tar")),
    ).rejects.toThrow(".tgz file");
  });

  it("retains executable modes from a bounded package tarball", () => {
    const archive = createTar("package/dist/cli/bin.js", "#!/usr/bin/env node\n", 0o755);
    const entries = readTarGzip(archive);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: "package/dist/cli/bin.js",
      mode: 0o755,
    });
    expect(entries[0]?.content.toString("utf8")).toBe("#!/usr/bin/env node\n");
  });

  it("pins smoke, leakage, and publish to the same workflow artifact", async () => {
    const [workflow, manifestText] = await Promise.all([
      readFile(join(process.cwd(), ".github", "workflows", "release.yml"), "utf8"),
      readFile(join(process.cwd(), "package.json"), "utf8"),
    ]);
    const manifest = JSON.parse(manifestText) as {
      scripts?: Record<string, string>;
    };

    expect(workflow).toContain("run: pnpm package:artifact");
    expect(workflow).toContain(
      "run: pnpm package:smoke --artifact .release/granttrace.tgz",
    );
    expect(workflow).toContain(
      "run: pnpm leakage:scan --artifact .release/granttrace.tgz",
    );
    expect(workflow).toContain(
      "run: npm publish .release/granttrace.tgz --provenance --access public --tag beta",
    );
    expect(manifest.scripts?.["package:artifact"]).toBe(
      "node scripts/create-package-artifact.mjs",
    );
  });
});

function createTar(path: string, content: string, mode: number): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, "utf8");
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, body.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeOctal(header, 148, 8, checksum);

  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return gzipSync(Buffer.concat([header, body, padding, Buffer.alloc(1024)]));
}

function writeOctal(
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  target.write(encoded, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}
