import { coerceConfigObjectNode, isConfigObjectNode } from "./config-object-node.js";

function mergeUnknown(baseValue: unknown, overrideValue: unknown): unknown {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (isConfigObjectNode(baseValue) && isConfigObjectNode(overrideValue)) {
    return mergeConfigObjects(baseValue, overrideValue);
  }

  return overrideValue;
}

export function mergeConfigObjects(
  baseRecord: Record<string, unknown>,
  overrideRecord: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseRecord };

  for (const [key, overrideValue] of Object.entries(overrideRecord)) {
    const baseValue = merged[key];
    merged[key] = mergeUnknown(baseValue, overrideValue);
  }

  return merged;
}

export function mergeConfigRoots(
  baseRoot: unknown,
  overrideRoot: unknown,
): Record<string, unknown> {
  return mergeConfigObjects(coerceConfigObjectNode(baseRoot), coerceConfigObjectNode(overrideRoot));
}
