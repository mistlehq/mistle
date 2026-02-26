export type UnknownRecord = Record<string, unknown>;

export function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

export function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }
  return value;
}

export function readNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  if (typeof value !== "number") {
    return null;
  }
  return value;
}

export function readBoolean(record: UnknownRecord, key: string): boolean | null {
  const value = record[key];
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

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
