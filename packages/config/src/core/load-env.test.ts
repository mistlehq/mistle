import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createEnvLoader, hasEntries, parseBooleanEnv } from "./load-env.js";

const TestSchema = z
  .object({
    name: z.string().min(1),
    port: z.number().int().min(1),
  })
  .strict();

describe("createEnvLoader", () => {
  it("maps env vars to config keys", () => {
    const loadFromEnv = createEnvLoader<typeof TestSchema>([
      {
        key: "name",
        envVar: "APP_NAME",
      },
      {
        key: "port",
        envVar: "APP_PORT",
        parse: Number,
      },
    ]);

    const loaded = loadFromEnv({
      APP_NAME: "control-plane",
      APP_PORT: "5100",
    });

    expect(loaded).toEqual({
      name: "control-plane",
      port: 5100,
    });
  });

  it("omits keys when env vars are missing", () => {
    const loadFromEnv = createEnvLoader<typeof TestSchema>([
      {
        key: "name",
        envVar: "APP_NAME",
      },
      {
        key: "port",
        envVar: "APP_PORT",
        parse: Number,
      },
    ]);

    const loaded = loadFromEnv({
      APP_NAME: "control-plane",
    });

    expect(loaded).toEqual({
      name: "control-plane",
    });
  });
});

describe("parseBooleanEnv", () => {
  it("parses true and false", () => {
    expect(parseBooleanEnv("true", "TEST_FLAG")).toBe(true);
    expect(parseBooleanEnv("false", "TEST_FLAG")).toBe(false);
  });

  it("throws for non-boolean strings", () => {
    expect(() => parseBooleanEnv("1", "TEST_FLAG")).toThrowError(
      "Invalid TEST_FLAG. Expected 'true' or 'false'.",
    );
  });
});

describe("hasEntries", () => {
  it("returns true only when an object has keys", () => {
    expect(hasEntries({})).toBe(false);
    expect(hasEntries({ key: "value" })).toBe(true);
  });
});
