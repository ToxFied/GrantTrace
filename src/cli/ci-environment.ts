export function isContinuousIntegration(
  environment: NodeJS.ProcessEnv,
): boolean {
  if (environment["GITHUB_ACTIONS"] === "true") {
    return true;
  }
  const value = environment["CI"]?.trim().toLowerCase();
  return (
    value !== undefined &&
    value !== "" &&
    value !== "0" &&
    value !== "false"
  );
}

export function renderCiContractMutationRefused(
  operation: string,
): string {
  return [
    `GrantTrace ${operation} refused`,
    "",
    "Accepted-contract mutations are disabled when CI is enabled.",
    "Review and update the contract in a trusted local checkout.",
    "",
  ].join("\n");
}
