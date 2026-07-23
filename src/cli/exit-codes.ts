export const ExitCode = {
  success: 0,
  usage: 2,
  instrumentation: 3,
  testFailure: 4,
  analysisFailure: 5,
  contractChanged: 6,
  evidenceBlocked: 7,
  proofFailed: 8,
  interrupted: 130,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
