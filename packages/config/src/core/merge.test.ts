import { describe, expect, it } from "vitest";

import { mergeConfigObjects, mergeConfigRoots } from "./merge.js";

describe("mergeConfigObjects", () => {
  it("deep merges object values", () => {
    const merged = mergeConfigObjects(
      {
        app: {
          host: "127.0.0.1",
          port: 5000,
        },
      },
      {
        app: {
          port: 5300,
        },
      },
    );

    expect(merged).toEqual({
      app: {
        host: "127.0.0.1",
        port: 5300,
      },
    });
  });

  it("keeps base value when override is undefined", () => {
    const base = {
      global: {
        env: "development",
      },
    };
    const merged = mergeConfigObjects(base, {
      apps: undefined,
    });

    expect(merged).toEqual(base);
  });

  it("replaces non-object values when override is defined", () => {
    const merged = mergeConfigObjects(
      {
        apps: {
          control_plane_api: {
            enabled: true,
          },
        },
      },
      {
        apps: "disabled",
      },
    );

    expect(merged).toEqual({
      apps: "disabled",
    });
  });
});

describe("mergeConfigRoots", () => {
  it("treats non-object roots as empty records", () => {
    const merged = mergeConfigRoots(null, {
      global: {
        env: "production",
      },
    });

    expect(merged).toEqual({
      global: {
        env: "production",
      },
    });
  });
});
