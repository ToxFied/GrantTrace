import { gunzipSync } from "node:zlib";

const BLOCK_SIZE = 512;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 2_000;

export function readTarGzip(archive) {
  const unpacked = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const entries = [];
  const seenPaths = new Set();
  let headerCount = 0;
  let offset = 0;
  let terminated = false;

  while (offset + BLOCK_SIZE <= unpacked.length) {
    const header = unpacked.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      const secondEnd = offset + BLOCK_SIZE * 2;
      if (
        secondEnd > unpacked.length ||
        !unpacked
          .subarray(offset + BLOCK_SIZE, secondEnd)
          .every((byte) => byte === 0) ||
        !unpacked.subarray(secondEnd).every((byte) => byte === 0)
      ) {
        throw new Error("Package archive has an invalid terminator.");
      }
      terminated = true;
      break;
    }

    const name = decodeString(header.subarray(0, 100));
    const prefix = decodeString(header.subarray(345, 500));
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const mode = decodeOctal(header.subarray(100, 108), "mode");
    const size = decodeOctal(header.subarray(124, 136), "size");
    const type = String.fromCharCode(header[156] ?? 0);
    const expectedChecksum = decodeOctal(
      header.subarray(148, 156),
      "checksum",
    );
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce(
      (total, byte) => total + byte,
      0,
    );
    if (actualChecksum !== expectedChecksum) {
      throw new Error("Package archive has an invalid checksum.");
    }
    const isRegularFile = type === "\0" || type === "0";
    const isDirectory = type === "5";
    if (
      (!isRegularFile && !isDirectory) ||
      !isSafeArchivePath(path, isDirectory) ||
      seenPaths.has(path) ||
      mode > 0o777 ||
      size > MAX_ENTRY_BYTES
    ) {
      throw new Error("Package archive contains an invalid entry.");
    }
    seenPaths.add(path);
    headerCount += 1;
    if (headerCount > MAX_ENTRIES) {
      throw new Error("Package archive contains too many entries.");
    }

    const contentStart = offset + BLOCK_SIZE;
    const contentEnd = contentStart + size;
    const nextOffset =
      contentStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    if (nextOffset > unpacked.length) {
      throw new Error("Package archive is truncated.");
    }
    if (!unpacked.subarray(contentEnd, nextOffset).every((byte) => byte === 0)) {
      throw new Error("Package archive contains invalid padding.");
    }
    if (isRegularFile) {
      entries.push({
        path,
        mode,
        content: unpacked.subarray(contentStart, contentEnd),
      });
    } else if (size !== 0) {
      throw new Error("Package archive contains an invalid directory.");
    }

    offset = nextOffset;
  }

  if (!terminated || entries.length === 0) {
    throw new Error("Package archive is incomplete.");
  }

  return entries;
}

function isSafeArchivePath(path, isDirectory) {
  const candidate =
    isDirectory && path.endsWith("/") ? path.slice(0, -1) : path;
  return (
    candidate.length > 0 &&
    (isDirectory || !path.endsWith("/")) &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !/[<>:"|?*\u0000-\u001f\u007f]/u.test(path) &&
    candidate
      .split("/")
      .every(
        (segment) =>
          segment.length > 0 &&
          segment !== "." &&
          segment !== ".." &&
          !/[ .]$/u.test(segment),
      )
  );
}

function decodeString(buffer) {
  const zero = buffer.indexOf(0);
  const bytes = buffer.subarray(0, zero === -1 ? buffer.length : zero);
  const value = bytes.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(bytes)) {
    throw new Error("Package archive contains invalid text.");
  }
  return value;
}

function decodeOctal(buffer, field) {
  const value = decodeString(buffer).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`Package archive contains an invalid ${field}.`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Package archive contains an unsafe ${field}.`);
  }
  return parsed;
}
