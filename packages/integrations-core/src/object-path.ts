const ForbiddenObjectPathKeys = new Set(["__proto__", "constructor", "prototype"]);

export function assertSafeObjectPath(
  path: ReadonlyArray<string>,
  invalidPathMessage: string,
): void {
  for (const key of path) {
    if (ForbiddenObjectPathKeys.has(key)) {
      throw new Error(invalidPathMessage);
    }
  }
}
