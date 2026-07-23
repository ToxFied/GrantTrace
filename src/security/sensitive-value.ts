import { inspect } from "node:util";

const REDACTED = "[REDACTED]";

/**
 * Makes accidental stringification and inspection safe. Callers must opt in
 * explicitly when a credential crosses its one intended boundary.
 */
export class SensitiveValue {
  readonly #value: string;

  public constructor(value: string) {
    if (value.length === 0) {
      throw new Error("A sensitive value cannot be empty.");
    }
    this.#value = value;
  }

  public reveal(): string {
    return this.#value;
  }

  public toJSON(): string {
    return REDACTED;
  }

  public toString(): string {
    return REDACTED;
  }

  public [inspect.custom](): string {
    return REDACTED;
  }
}
