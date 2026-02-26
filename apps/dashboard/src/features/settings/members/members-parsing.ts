import { dateFromEpochMs } from "@mistle/time";

import type { OrganizationRole } from "./members-api-types.js";

export function parseOrganizationRoleValue(value: unknown): OrganizationRole | null {
  if (typeof value !== "string") {
    return null;
  }

  if (value === "owner" || value === "admin" || value === "member") {
    return value;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return null;
  }

  if (entries.some((entry) => entry !== "owner" && entry !== "admin" && entry !== "member")) {
    return null;
  }

  if (entries.some((entry) => entry === "owner")) {
    return "owner";
  }
  if (entries.some((entry) => entry === "admin")) {
    return "admin";
  }
  if (entries.some((entry) => entry === "member")) {
    return "member";
  }
  return null;
}

export function parseTimestampToIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    if (!Number.isFinite(epochMs)) {
      return null;
    }
    return dateFromEpochMs(epochMs).toISOString();
  }

  if (typeof value !== "string") {
    if (typeof value !== "number") {
      return null;
    }
    const fromEpochNumber = dateFromEpochMs(value).toISOString();
    if (Date.parse(fromEpochNumber) !== value) {
      return null;
    }
    return fromEpochNumber;
  }

  const epochMs = parseEpochMillisecondsFromTimestamp(value);
  if (epochMs === null) {
    return null;
  }

  return dateFromEpochMs(epochMs).toISOString();
}

function parseEpochMillisecondsFromTimestamp(value: string): number | null {
  const directEpochMs = Date.parse(value);
  if (Number.isFinite(directEpochMs)) {
    return directEpochMs;
  }

  const trimmedValue = value.trim();
  if (/^\d{10,13}$/u.test(trimmedValue)) {
    const parsedEpoch = Number.parseInt(trimmedValue, 10);
    if (!Number.isNaN(parsedEpoch)) {
      return trimmedValue.length === 10 ? parsedEpoch * 1000 : parsedEpoch;
    }
  }

  const normalizedBasic = trimmedValue.replace(" ", "T");
  const normalizedEpochMs = Date.parse(normalizedBasic);
  if (Number.isFinite(normalizedEpochMs)) {
    return normalizedEpochMs;
  }

  const offsetNormalized = normalizedBasic
    .replace(/([+-]\d{2})$/, "$1:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    .replace(/([+-]\d{2}:\d{2}):\d{2}$/, "$1");
  const offsetEpochMs = Date.parse(offsetNormalized);
  if (Number.isFinite(offsetEpochMs)) {
    return offsetEpochMs;
  }

  const highPrecisionNormalized = offsetNormalized.replace(
    /\.(\d{3})\d+(?=(Z|[+-]\d{2}:\d{2}|$))/,
    ".$1",
  );
  const highPrecisionEpochMs = Date.parse(highPrecisionNormalized);
  if (Number.isFinite(highPrecisionEpochMs)) {
    return highPrecisionEpochMs;
  }

  return null;
}
