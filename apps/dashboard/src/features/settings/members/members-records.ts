import { z } from "zod";

const ObjectValueSchema = z.custom<object>(
  (value): value is object => typeof value === "object" && value !== null,
);
const UnknownArraySchema = z.array(z.unknown());
const StringSchema = z.string();
const NumberSchema = z.number();
const BooleanSchema = z.boolean();

export type UnknownRecord = Record<string, unknown>;

export function toRecord(value: unknown): UnknownRecord | null {
  const parsed = ObjectValueSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(parsed.data)) {
    record[key] = entryValue;
  }

  return record;
}

export function readString(record: UnknownRecord, key: string): string | null {
  const parsed = StringSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readNumber(record: UnknownRecord, key: string): number | null {
  const parsed = NumberSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readBoolean(record: UnknownRecord, key: string): boolean | null {
  const parsed = BooleanSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readArray(value: unknown): unknown[] | null {
  const parsed = UnknownArraySchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
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
