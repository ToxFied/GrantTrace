import { GITHUB_API_VERSION } from "../version.js";

export class RecorderPersistenceError extends Error {
  public constructor() {
    super("GrantTrace could not persist a safe observation.");
    this.name = "RecorderPersistenceError";
  }
}

export class ApiVersionMismatchError extends Error {
  public constructor() {
    super(
      `GrantTrace recording requires GitHub REST API version ${GITHUB_API_VERSION}.`,
    );
    this.name = "ApiVersionMismatchError";
  }
}
