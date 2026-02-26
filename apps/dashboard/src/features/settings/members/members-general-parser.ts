import { readBoolean, toRecord } from "./members-records.js";

export function parseOrganizationSlugAvailability(value: unknown): boolean {
  const record = toRecord(value);
  if (record === null) {
    throw new Error("Organization slug response was invalid.");
  }

  const status = readBoolean(record, "status");
  if (status !== null) {
    return status;
  }

  const available = readBoolean(record, "available");
  if (available !== null) {
    return available;
  }

  throw new Error("Organization slug response was missing availability.");
}
