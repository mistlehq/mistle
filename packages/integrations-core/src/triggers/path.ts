export type PathPropertyAccessMode = "own" | "plain";

export type GetValueAtPathOptions = {
  allowArrayTraversal: boolean;
  propertyAccess: PathPropertyAccessMode;
};

function readOwnPropertyValue(target: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    return undefined;
  }

  if ("value" in descriptor) {
    return descriptor.value;
  }

  return descriptor.get?.call(target);
}

function readObjectProperty(input: {
  target: object;
  key: string;
  propertyAccess: PathPropertyAccessMode;
}): unknown {
  if (input.propertyAccess === "own") {
    if (!Object.prototype.hasOwnProperty.call(input.target, input.key)) {
      return undefined;
    }

    return readOwnPropertyValue(input.target, input.key);
  }

  if (!Object.prototype.hasOwnProperty.call(input.target, input.key)) {
    return undefined;
  }

  return (input.target as Record<string, unknown>)[input.key];
}

export function getValueAtPath(input: {
  payload: unknown;
  path: ReadonlyArray<string>;
  options: GetValueAtPathOptions;
}): unknown {
  let cursor: unknown = input.payload;

  for (const segment of input.path) {
    if (Array.isArray(cursor)) {
      if (!input.options.allowArrayTraversal) {
        return undefined;
      }

      const segmentAsInteger = Number(segment);
      if (!Number.isInteger(segmentAsInteger) || segmentAsInteger < 0) {
        return undefined;
      }

      cursor = cursor[segmentAsInteger];
      continue;
    }

    if (typeof cursor !== "object" || cursor === null) {
      return undefined;
    }

    cursor = readObjectProperty({
      target: cursor,
      key: segment,
      propertyAccess: input.options.propertyAccess,
    });
  }

  return cursor;
}

export function splitDotPath(path: string): ReadonlyArray<string> {
  return path.split(".");
}
