import { describe, expect, it } from "vitest";

import { createAppConfig } from "../test/fixtures/config.js";
import { mergeConfigObjects, mergeConfigRoots } from "./merge.js";

describe("mergeConfigObjects", () => {
  it("deep merges object values", () => {
    const merged = mergeConfigObjects(createAppConfig(), {
      apps: {
        control_plane_api: {
          port: 5300,
        },
      },
    });

    expect(merged).toEqual(
      createAppConfig({
        controlPlaneApi: {
          port: 5300,
        },
      }),
    );
  });

  it("keeps base value when override is undefined", () => {
    const merged = mergeConfigObjects(createAppConfig(), {
      apps: undefined,
    });

    expect(merged).toEqual(createAppConfig());
  });

  it("replaces non-object values when override is defined", () => {
    const merged = mergeConfigObjects(createAppConfig(), {
      apps: "disabled",
    });

    expect(merged).toEqual({
      ...createAppConfig(),
      apps: "disabled",
    });
  });
});

describe("mergeConfigRoots", () => {
  it("treats non-object roots as empty records", () => {
    const merged = mergeConfigRoots(
      null,
      createAppConfig({
        global: {
          env: "production",
        },
      }),
    );

    expect(merged).toEqual(
      createAppConfig({
        global: {
          env: "production",
        },
      }),
    );
  });
});
