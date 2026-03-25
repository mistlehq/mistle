import { isRecord } from "./is-record.js";

export type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type BrowserStorageKind = "local" | "session";

export function getBestEffortBrowserStorage(kind: BrowserStorageKind): BrowserStorage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    if (
      typeof storage !== "object" ||
      storage === null ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" ||
      typeof storage.removeItem !== "function"
    ) {
      return null;
    }

    return storage;
  } catch {
    return null;
  }
}

export function readBrowserStorageItem(input: {
  key: string;
  storage: Pick<Storage, "getItem"> | null;
}): string | null {
  if (input.storage === null) {
    return null;
  }

  try {
    return input.storage.getItem(input.key);
  } catch {
    return null;
  }
}

export function writeBrowserStorageItem(input: {
  key: string;
  value: string;
  storage: Pick<Storage, "setItem"> | null;
}): boolean {
  if (input.storage === null) {
    return false;
  }

  try {
    input.storage.setItem(input.key, input.value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorageItem(input: {
  key: string;
  storage: Pick<Storage, "removeItem"> | null;
}): boolean {
  if (input.storage === null) {
    return false;
  }

  try {
    input.storage.removeItem(input.key);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserStorageJson<T>(input: {
  key: string;
  storage: Pick<Storage, "getItem" | "removeItem"> | null;
  isValue: (value: unknown) => value is T;
}): T | null {
  const storedValue = readBrowserStorageItem({
    key: input.key,
    storage: input.storage,
  });
  if (storedValue === null) {
    return null;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    removeBrowserStorageItem({
      key: input.key,
      storage: input.storage,
    });
    return null;
  }

  if (!input.isValue(parsedValue)) {
    removeBrowserStorageItem({
      key: input.key,
      storage: input.storage,
    });
    return null;
  }

  return parsedValue;
}

export function writeBrowserStorageJson(input: {
  key: string;
  value: unknown;
  storage: Pick<Storage, "setItem"> | null;
}): boolean {
  return writeBrowserStorageItem({
    key: input.key,
    value: JSON.stringify(input.value),
    storage: input.storage,
  });
}

export function isExpiringBrowserStorageRecord<T>(
  value: unknown,
  isStoredValue: (storedValue: unknown) => storedValue is T,
): value is {
  value: T;
  expiresAtMs: number;
} {
  if (!isRecord(value)) {
    return false;
  }

  return isStoredValue(value["value"]) && typeof value["expiresAtMs"] === "number";
}
