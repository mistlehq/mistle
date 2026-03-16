import { z } from "zod";

const ObjectValueSchema = z.custom<object>(
  (value): value is object => typeof value === "object" && value !== null,
);
const MembersRecordSchema = z.record(z.string(), z.unknown());
const UnknownArraySchema = z.array(z.unknown());
const StringSchema = z.string();
const NumberSchema = z.number();
const BooleanSchema = z.boolean();

export type MembersRecordValue = z.infer<typeof MembersRecordSchema>;

export function parseMembersRecord(value: unknown): MembersRecordValue | null {
  const parsed = ObjectValueSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  return MembersRecordSchema.parse(Object.fromEntries(Object.entries(parsed.data)));
}

export function readMembersString(record: MembersRecordValue, key: string): string | null {
  const parsed = StringSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readMembersNumber(record: MembersRecordValue, key: string): number | null {
  const parsed = NumberSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readMembersBoolean(record: MembersRecordValue, key: string): boolean | null {
  const parsed = BooleanSchema.safeParse(record[key]);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export function readMembersArray(value: unknown): unknown[] | null {
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
