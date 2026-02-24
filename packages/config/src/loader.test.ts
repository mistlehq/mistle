import { describe, expect, it } from "vitest";

import { loadConfig, parseConfigRecord } from "./loader.js";
import { AppIds } from "./modules.js";
import { createAppConfig } from "./test/fixtures/config.js";

describe("parseConfigRecord", () => {
  it("parses a minimal config record", () => {
    const config = parseConfigRecord(createAppConfig());

    expect(config).toEqual(createAppConfig());
  });
});

describe("loadConfig", () => {
  it("fails when configPath and env are both missing", () => {
    expect(() =>
      loadConfig({
        app: AppIds.CONTROL_PLANE_API,
      }),
    ).toThrowError(/Missing config source/);
  });
});
