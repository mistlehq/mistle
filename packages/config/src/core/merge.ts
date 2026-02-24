import { asObjectRecord, isObjectRecord } from "./record.js";

function mergeUnknown(baseValue: unknown, overrideValue: unknown): unknown {
  if (overrideValue === undefined) {
    return baseValue;
  }

  if (isObjectRecord(baseValue) && isObjectRecord(overrideValue)) {
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
  return mergeConfigObjects(asObjectRecord(baseRoot), asObjectRecord(overrideRoot));
}
