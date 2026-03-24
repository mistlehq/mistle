import { describe, expect, it } from "vitest";

import {
  getBestEffortBrowserStorage,
  isExpiringBrowserStorageRecord,
  readBrowserStorageItem,
  readBrowserStorageJson,
  removeBrowserStorageItem,
  writeBrowserStorageItem,
  writeBrowserStorageJson,
} from "./browser-storage.js";
import { isRecord } from "./is-record.js";

describe("browser storage helpers", () => {
  it("returns null when browser storage access throws", () => {
    const originalWindow = globalThis.window;
    const throwingWindow = {
      get localStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
      get sessionStorage(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    } as Window;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: throwingWindow,
    });

    try {
      expect(getBestEffortBrowserStorage("local")).toBeNull();
      expect(getBestEffortBrowserStorage("session")).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("treats storage operation failures as best-effort misses", () => {
    const storage = {
      getItem(): string | null {
        throw new DOMException("Blocked", "SecurityError");
      },
      removeItem(): void {
        throw new DOMException("Blocked", "SecurityError");
      },
      setItem(): void {
        throw new DOMException("Blocked", "SecurityError");
      },
    };

    expect(
      readBrowserStorageItem({
        key: "test-key",
        storage,
      }),
    ).toBeNull();
    expect(
      writeBrowserStorageItem({
        key: "test-key",
        value: "test-value",
        storage,
      }),
    ).toBe(false);
    expect(
      removeBrowserStorageItem({
        key: "test-key",
        storage,
      }),
    ).toBe(false);
  });

  it("removes malformed JSON storage items on read", () => {
    const removedKeys: string[] = [];
    const storage = {
      getItem(): string | null {
        return "{not-json";
      },
      removeItem(key: string): void {
        removedKeys.push(key);
      },
    };

    expect(
      readBrowserStorageJson({
        key: "bad-json",
        storage,
        isValue: (value): value is { ok: boolean } =>
          typeof value === "object" && value !== null && "ok" in value,
      }),
    ).toBeNull();
    expect(removedKeys).toEqual(["bad-json"]);
  });

  it("removes invalid JSON payloads on read", () => {
    const removedKeys: string[] = [];
    const storage = {
      getItem(): string | null {
        return JSON.stringify({ wrong: true });
      },
      removeItem(key: string): void {
        removedKeys.push(key);
      },
    };

    expect(
      readBrowserStorageJson({
        key: "invalid-json",
        storage,
        isValue: (value): value is { ok: boolean } =>
          isRecord(value) && Reflect.get(value, "ok") === true,
      }),
    ).toBeNull();
    expect(removedKeys).toEqual(["invalid-json"]);
  });

  it("writes and reads JSON payloads through the shared helpers", () => {
    let storedValue: string | null = null;
    const storage = {
      getItem(): string | null {
        return storedValue;
      },
      removeItem(): void {
        storedValue = null;
      },
      setItem(_key: string, value: string): void {
        storedValue = value;
      },
    };

    expect(
      writeBrowserStorageJson({
        key: "json-key",
        value: {
          ok: true,
        },
        storage,
      }),
    ).toBe(true);

    expect(
      readBrowserStorageJson({
        key: "json-key",
        storage,
        isValue: (value): value is { ok: boolean } =>
          isRecord(value) && Reflect.get(value, "ok") === true,
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("validates expiring record payloads", () => {
    expect(
      isExpiringBrowserStorageRecord(
        {
          value: "resume-key",
          expiresAtMs: Date.now() + 60_000,
        },
        (value): value is string => typeof value === "string",
      ),
    ).toBe(true);

    expect(
      isExpiringBrowserStorageRecord(
        {
          value: 123,
          expiresAtMs: "later",
        },
        (value): value is string => typeof value === "string",
      ),
    ).toBe(false);
  });
});
