export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asObjectRecord(value: unknown): Record<string, unknown> {
  return isObjectRecord(value) ? value : {};
}

export function getValueAtPath(root: unknown, path: readonly string[]): unknown {
  let current = root;

  for (const segment of path) {
    if (!isObjectRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function setValueAtPath(
  root: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    return root;
  }

  const nextRoot: Record<string, unknown> = { ...root };
  let cursor = nextRoot;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const nextSegment = asObjectRecord(cursor[segment]);
    const clonedSegment = { ...nextSegment };
    cursor[segment] = clonedSegment;
    cursor = clonedSegment;
  }

  const finalSegment = path[path.length - 1]!;
  cursor[finalSegment] = value;

  return nextRoot;
}
