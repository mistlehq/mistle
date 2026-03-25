const RuntimeCommandNames = new Set(["serve", "apply-startup", "runtime-internal"]);

export type RuntimeCommandName = "serve" | "apply-startup" | "runtime-internal";

export function resolveRuntimeCommandName(processArgv: readonly string[]): RuntimeCommandName {
  for (let index = processArgv.length - 1; index >= 1; index -= 1) {
    const candidate = processArgv[index];
    if (isRuntimeCommandName(candidate)) {
      return candidate;
    }
  }

  const userArgs = processArgv.slice(1);
  if (userArgs.length === 0) {
    return "serve";
  }

  const firstUserArg = userArgs[0];
  if (
    firstUserArg !== undefined &&
    userArgs.length === 1 &&
    looksLikeEntrypointPath(firstUserArg)
  ) {
    return "serve";
  }

  throw new Error(`unsupported sandbox runtime command "${String(userArgs.at(-1))}"`);
}

function isRuntimeCommandName(value: string | undefined): value is RuntimeCommandName {
  return value !== undefined && RuntimeCommandNames.has(value);
}

function looksLikeEntrypointPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("file:") ||
    value.endsWith(".js") ||
    value.endsWith(".mjs") ||
    value.endsWith(".cjs")
  );
}
