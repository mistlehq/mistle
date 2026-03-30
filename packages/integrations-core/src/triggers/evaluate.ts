import { containsToken } from "./operators.js";

export type SharedFilterScalar = string | number | boolean;

export type SharedFilter =
  | {
      op: "all";
      filters: ReadonlyArray<SharedFilter>;
    }
  | {
      op: "any";
      filters: ReadonlyArray<SharedFilter>;
    }
  | {
      op: "not";
      filter: SharedFilter;
    }
  | {
      op: "eq";
      path: ReadonlyArray<string>;
      value: SharedFilterScalar;
    }
  | {
      op: "in";
      path: ReadonlyArray<string>;
      values: ReadonlyArray<SharedFilterScalar>;
    }
  | {
      op: "contains";
      path: ReadonlyArray<string>;
      value: string;
    }
  | {
      op: "containsToken";
      path: ReadonlyArray<string>;
      value: string;
    }
  | {
      op: "startsWith";
      path: ReadonlyArray<string>;
      value: string;
    }
  | {
      op: "exists";
      path: ReadonlyArray<string>;
    };

export function evaluateFilterNode(input: {
  filter: SharedFilter;
  resolveValueAtPath(this: void, path: ReadonlyArray<string>): unknown;
}): boolean {
  const { filter } = input;

  if (filter.op === "all") {
    return filter.filters.every((nestedFilter) =>
      evaluateFilterNode({
        filter: nestedFilter,
        resolveValueAtPath: input.resolveValueAtPath,
      }),
    );
  }

  if (filter.op === "any") {
    return filter.filters.some((nestedFilter) =>
      evaluateFilterNode({
        filter: nestedFilter,
        resolveValueAtPath: input.resolveValueAtPath,
      }),
    );
  }

  if (filter.op === "not") {
    return !evaluateFilterNode({
      filter: filter.filter,
      resolveValueAtPath: input.resolveValueAtPath,
    });
  }

  const resolvedValue = input.resolveValueAtPath(filter.path);

  if (filter.op === "exists") {
    return resolvedValue !== undefined;
  }

  if (filter.op === "eq") {
    return resolvedValue === filter.value;
  }

  if (filter.op === "in") {
    if (
      typeof resolvedValue !== "string" &&
      typeof resolvedValue !== "number" &&
      typeof resolvedValue !== "boolean"
    ) {
      return false;
    }

    return filter.values.includes(resolvedValue);
  }

  if (filter.op === "contains") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.includes(filter.value);
  }

  if (filter.op === "containsToken") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return containsToken({
      value: resolvedValue,
      token: filter.value,
    });
  }

  if (filter.op === "startsWith") {
    if (typeof resolvedValue !== "string") {
      return false;
    }

    return resolvedValue.startsWith(filter.value);
  }

  return false;
}
