import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createEnvLoader } from "./load-env.js";

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
        parse: (value) => value,
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
        parse: (value) => value,
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
