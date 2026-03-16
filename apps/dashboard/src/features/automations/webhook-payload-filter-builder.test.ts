import { describe, expect, it } from "vitest";

import {
  buildPayloadFilterFromConditions,
  formatPayloadFilterText,
  parsePayloadFilterBuilder,
  validatePayloadFilterConditions,
} from "./webhook-payload-filter-builder.js";

describe("parsePayloadFilterBuilder", () => {
  it("parses flat all-condition filters into builder state", () => {
    expect(
      parsePayloadFilterBuilder({
        payloadFilter: {
          op: "and",
          filters: [
            {
              op: "eq",
              path: ["issue", "state"],
              value: "open",
            },
            {
              op: "exists",
              path: ["repository", "full_name"],
            },
          ],
        },
      }),
    ).toEqual({
      supported: true,
      mode: "all",
      conditions: [
        {
          id: "condition_0",
          pathText: "issue.state",
          operator: "eq",
          valueType: "string",
          valueText: "open",
          valuesText: "",
        },
        {
          id: "condition_1",
          pathText: "repository.full_name",
          operator: "exists",
          valueType: "string",
          valueText: "",
          valuesText: "",
        },
      ],
    });
  });

  it("marks nested logical filters as unsupported", () => {
    expect(
      parsePayloadFilterBuilder({
        payloadFilter: {
          op: "and",
          filters: [
            {
              op: "or",
              filters: [
                {
                  op: "eq",
                  path: ["issue", "state"],
                  value: "open",
                },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      supported: false,
    });
  });
});

describe("buildPayloadFilterFromConditions", () => {
  it("builds a single condition filter without wrapping it in and/or", () => {
    expect(
      buildPayloadFilterFromConditions({
        mode: "all",
        conditions: [
          {
            id: "condition_0",
            pathText: "issue.state",
            operator: "eq",
            valueType: "string",
            valueText: "open",
            valuesText: "",
          },
        ],
      }),
    ).toEqual({
      success: true,
      value: {
        op: "eq",
        path: ["issue", "state"],
        value: "open",
      },
    });
  });

  it("builds any-condition filters with typed scalar values", () => {
    expect(
      buildPayloadFilterFromConditions({
        mode: "any",
        conditions: [
          {
            id: "condition_0",
            pathText: "issue.comments",
            operator: "in",
            valueType: "number",
            valueText: "",
            valuesText: "1, 2, 3",
          },
          {
            id: "condition_1",
            pathText: "sender.type",
            operator: "neq",
            valueType: "string",
            valueText: "Bot",
            valuesText: "",
          },
        ],
      }),
    ).toEqual({
      success: true,
      value: {
        op: "or",
        filters: [
          {
            op: "in",
            path: ["issue", "comments"],
            values: [1, 2, 3],
          },
          {
            op: "neq",
            path: ["sender", "type"],
            value: "Bot",
          },
        ],
      },
    });
  });
});

describe("validatePayloadFilterConditions", () => {
  it("returns a validation error for incomplete conditions", () => {
    expect(
      validatePayloadFilterConditions({
        conditions: [
          {
            id: "condition_0",
            pathText: "",
            operator: "contains",
            valueType: "string",
            valueText: "",
            valuesText: "",
          },
        ],
      }),
    ).toBe("Conditions must include a field path and valid value for the selected operator.");
  });
});

describe("formatPayloadFilterText", () => {
  it("formats null as an empty string", () => {
    expect(formatPayloadFilterText(null)).toBe("");
  });
});
