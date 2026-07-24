import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

export type BoundedFileFailure =
  | "changed"
  | "too_large"
  | "unsafe_type";

export class BoundedFileError extends Error {
  public constructor(public readonly code: BoundedFileFailure) {
    super(`The bounded file could not be read safely (${code}).`);
    this.name = "BoundedFileError";
  }
}

export async function readBoundedRegularFile(
  path: string,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new BoundedFileError("too_large");
  }

  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new BoundedFileError("unsafe_type");
  }
  if (before.size > maximumBytes) {
    throw new BoundedFileError("too_large");
  }

  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new BoundedFileError("changed");
    }
    if (opened.size > maximumBytes) {
      throw new BoundedFileError("too_large");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maximumBytes) {
      const remaining = maximumBytes + 1 - total;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(
        chunk,
        0,
        chunk.length,
        total,
      );
      if (bytesRead === 0) {
        return Buffer.concat(chunks, total);
      }
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
    }
    throw new BoundedFileError("too_large");
  } finally {
    await handle.close();
  }
}
