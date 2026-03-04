export {
  readBoolean,
  readNumber,
  readString,
  toRecord,
  type UnknownRecord,
} from "../../../lib/unknown-record.js";

export function readArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value;
}

export function compactMap<TInput, TOutput>(
  values: readonly TInput[],
  map: (value: TInput) => TOutput | null,
): TOutput[] {
  const parsed: TOutput[] = [];
  for (const value of values) {
    const mapped = map(value);
    if (mapped !== null) {
      parsed.push(mapped);
    }
  }
  return parsed;
}
