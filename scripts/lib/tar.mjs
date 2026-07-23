import { gunzipSync } from "node:zlib";

const BLOCK_SIZE = 512;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 2_000;

export function readTarGzip(archive) {
  const unpacked = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES });
  const entries = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= unpacked.length) {
    const header = unpacked.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = decodeString(header.subarray(0, 100));
    const prefix = decodeString(header.subarray(345, 500));
    const path = prefix.length === 0 ? name : `${prefix}/${name}`;
    const size = decodeOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] ?? 0);
    const expectedChecksum = decodeOctal(header.subarray(148, 156));
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const actualChecksum = checksumHeader.reduce(
      (total, byte) => total + byte,
      0,
    );
    if (actualChecksum !== expectedChecksum) {
      throw new Error("Package archive has an invalid checksum.");
    }
    if (
      path.length === 0 ||
      path.includes("\0") ||
      path.includes("\\") ||
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      size > MAX_ENTRY_BYTES
    ) {
      throw new Error("Package archive contains an invalid entry.");
    }

    const contentStart = offset + BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > unpacked.length) {
      throw new Error("Package archive is truncated.");
    }
    if (type === "\0" || type === "0") {
      entries.push({ path, content: unpacked.subarray(contentStart, contentEnd) });
      if (entries.length > MAX_ENTRIES) {
        throw new Error("Package archive contains too many entries.");
      }
    } else if (type === "5" && size !== 0) {
      throw new Error("Package archive contains an invalid directory.");
    } else if (type !== "5") {
      throw new Error("Package archive contains a non-regular entry.");
    }

    offset =
      contentStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return entries;
}

function decodeString(buffer) {
  const zero = buffer.indexOf(0);
  return buffer
    .subarray(0, zero === -1 ? buffer.length : zero)
    .toString("utf8");
}

function decodeOctal(buffer) {
  const value = decodeString(buffer).trim();
  if (!/^[0-7]*$/u.test(value)) {
    throw new Error("Package archive contains an invalid size.");
  }
  const parsed = value.length === 0 ? 0 : Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Package archive contains an unsafe size.");
  }
  return parsed;
}
