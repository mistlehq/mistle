import { describe, expect, it } from "vitest";

import { getValueAtPath } from "./path.js";

describe("trigger path helpers", () => {
  it("can traverse arrays when enabled", () => {
    const value = getValueAtPath({
      payload: {
        labels: [
          {
            name: "bug",
          },
          {
            name: "urgent",
          },
        ],
      },
      path: ["labels", "1", "name"],
      options: {
        allowArrayTraversal: true,
        propertyAccess: "own",
      },
    });

    expect(value).toBe("urgent");
  });

  it("does not traverse arrays when disabled", () => {
    const value = getValueAtPath({
      payload: {
        labels: [
          {
            name: "bug",
          },
        ],
      },
      path: ["labels", "0", "name"],
      options: {
        allowArrayTraversal: false,
        propertyAccess: "plain",
      },
    });

    expect(value).toBeUndefined();
  });

  it("can restrict lookup to own properties", () => {
    const base = {
      inherited: "hidden",
    };
    const payload = Object.assign(Object.create(base), {
      visible: "shown",
    });

    expect(
      getValueAtPath({
        payload,
        path: ["visible"],
        options: {
          allowArrayTraversal: false,
          propertyAccess: "own",
        },
      }),
    ).toBe("shown");

    expect(
      getValueAtPath({
        payload,
        path: ["inherited"],
        options: {
          allowArrayTraversal: false,
          propertyAccess: "own",
        },
      }),
    ).toBeUndefined();
  });

  it("does not read inherited properties in plain mode", () => {
    const base = {
      inherited: "hidden",
    };
    const payload = Object.create(base);

    const value = getValueAtPath({
      payload,
      path: ["inherited"],
      options: {
        allowArrayTraversal: false,
        propertyAccess: "plain",
      },
    });

    expect(value).toBeUndefined();
  });
});
