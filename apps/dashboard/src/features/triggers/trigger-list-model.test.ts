import { describe, expect, it } from "vitest";

import {
  normalizeTriggerListSearch,
  toTriggerListFilter,
  toTriggerListServerFilters,
  TRIGGER_LIST_FILTER_OPTIONS,
} from "./trigger-list-model.js";

describe("trigger list model", () => {
  it("accepts every configured filter option", () => {
    for (const filterOption of TRIGGER_LIST_FILTER_OPTIONS) {
      expect(toTriggerListFilter(filterOption.value)).toBe(filterOption.value);
    }
  });

  it("maps list filter values to server-side query filters", () => {
    expect(toTriggerListServerFilters("all")).toEqual({});
    expect(toTriggerListServerFilters("enabled")).toEqual({ enabled: true });
    expect(toTriggerListServerFilters("disabled")).toEqual({ enabled: false });
    expect(toTriggerListServerFilters("events")).toEqual({ kind: "webhook" });
    expect(toTriggerListServerFilters("schedules")).toEqual({ kind: "schedule" });
  });

  it("normalizes search text before sending it to the server", () => {
    expect(normalizeTriggerListSearch("  pull request  ")).toBe("pull request");
    expect(normalizeTriggerListSearch("   ")).toBeUndefined();
  });
});
