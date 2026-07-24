export function injectRuntimePreload(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnvironment = { ...environment };
  const preloadOptions: string[] = [];

  if (import.meta.url.endsWith(".ts")) {
    preloadOptions.push(`--import=${import.meta.resolve("tsx")}`);
  }
  const preloadName = import.meta.url.endsWith(".ts")
    ? "preload.ts"
    : "preload.js";
  preloadOptions.push(
    `--import=${new URL(preloadName, import.meta.url).href}`,
  );

  const existing = childEnvironment["NODE_OPTIONS"]?.trim();
  childEnvironment["NODE_OPTIONS"] = [
    existing === undefined || existing.length === 0 ? null : existing,
    ...preloadOptions,
  ]
    .filter((value) => value !== null)
    .join(" ");
  return childEnvironment;
}
