import { describe, expect, test } from "vitest";

import { startHttpEcho } from "../src/index.js";

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function readHeaderValue(headers: unknown, headerName: string): string | undefined {
  if (typeof headers !== "object" || headers === null) {
    return undefined;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== headerName.toLowerCase()) {
      continue;
    }

    if (typeof value === "string") {
      return value;
    }
  }

  return undefined;
}

describe("http echo service integration", () => {
  test("starts echo container and returns echoed request details", async () => {
    const echoService = await startHttpEcho();

    try {
      const response = await fetch(`${echoService.baseUrl}/echo-path?stream=true`, {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          "x-tokenizer-test": "hello",
        },
        body: "hello-echo",
      });

      expect(response.status).toBe(200);
      const responseBody: unknown = await response.json();
      const responseRecord = toRecord(responseBody);
      if (responseRecord === null) {
        throw new Error("Expected HTTP echo response body to be an object.");
      }

      expect(responseRecord["method"]).toBe("POST");
      expect(responseRecord["path"]).toBe("/echo-path");
      expect(readHeaderValue(responseRecord["headers"], "x-tokenizer-test")).toBe("hello");
      expect(responseRecord["body"]).toBe("hello-echo");
    } finally {
      await echoService.stop();
    }
  }, 60_000);

  test("throws when stopping the same echo service twice", async () => {
    const echoService = await startHttpEcho();
    await echoService.stop();

    await expect(echoService.stop()).rejects.toThrowError(
      "HTTP echo container was already stopped.",
    );
  }, 60_000);
});
