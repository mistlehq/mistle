export type ConfigObjectNode = {
  [key: string]: unknown;
};

export function isConfigObjectNode(value: unknown): value is ConfigObjectNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function coerceConfigObjectNode(value: unknown): ConfigObjectNode {
  return isConfigObjectNode(value) ? value : {};
}

export function getConfigValueAtPath(root: unknown, path: readonly string[]): unknown {
  let current = root;

  for (const segment of path) {
    if (!isConfigObjectNode(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function setConfigValueAtPath(
  root: ConfigObjectNode,
  path: readonly string[],
  value: unknown,
): ConfigObjectNode {
  if (path.length === 0) {
    return root;
  }

  const nextRoot: ConfigObjectNode = { ...root };
  let cursor = nextRoot;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!;
    const nextSegment = coerceConfigObjectNode(cursor[segment]);
    const clonedSegment = { ...nextSegment };
    cursor[segment] = clonedSegment;
    cursor = clonedSegment;
  }

  const finalSegment = path[path.length - 1]!;
  cursor[finalSegment] = value;

  return nextRoot;
}
