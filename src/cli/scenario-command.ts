import { parseBoundedDuration } from "./duration.js";

export type ScenarioCommandArguments = {
  scenario: string;
  command: string;
  commandArgs: string[];
  timeoutMs: number;
};

export type ScenarioCommandParseResult =
  | { success: true; value: ScenarioCommandArguments }
  | { success: false; message: string };

export function parseScenarioCommand(
  args: string[],
  maximumTimeoutMs: number,
): ScenarioCommandParseResult {
  const separator = args.indexOf("--");
  if (separator < 0) {
    return {
      success: false,
      message: "Missing -- before the child command.",
    };
  }
  if (separator === args.length - 1) {
    return {
      success: false,
      message: "A child command is required after --.",
    };
  }

  const options = args.slice(0, separator);
  let scenario: string | null = null;
  let timeoutMs = 15 * 60 * 1_000;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    if (option === undefined) {
      return {
        success: false,
        message: "Unknown or misplaced option before --.",
      };
    }
    const value = options[index + 1];
    if (!option.startsWith("-")) {
      if (scenario !== null) {
        return {
          success: false,
          message: "Provide exactly one scenario name.",
        };
      }
      scenario = option;
      continue;
    }
    if (option === "--scenario") {
      if (scenario !== null || value === undefined || value.startsWith("-")) {
        return {
          success: false,
          message: "Provide exactly one scenario name.",
        };
      }
      scenario = value;
      index += 1;
      continue;
    }
    if (option === "--timeout") {
      if (value === undefined) {
        return {
          success: false,
          message: "Provide a duration after --timeout.",
        };
      }
      const parsed = parseBoundedDuration(value, {
        minimumMs: 1_000,
        maximumMs: maximumTimeoutMs,
      });
      if (parsed === null) {
        return {
          success: false,
          message: `Timeout must be between 1s and ${maximumTimeoutMs / 60_000}m.`,
        };
      }
      timeoutMs = parsed;
      index += 1;
      continue;
    }
    return {
      success: false,
      message: "Unknown or misplaced option before --.",
    };
  }
  if (scenario === null) {
    return {
      success: false,
      message: "A scenario name is required before --.",
    };
  }
  const command = args[separator + 1];
  if (command === undefined || command.length === 0) {
    return {
      success: false,
      message: "A child command is required after --.",
    };
  }
  return {
    success: true,
    value: {
      scenario,
      command,
      commandArgs: args.slice(separator + 2),
      timeoutMs,
    },
  };
}
