import { describe, expect, it } from "vitest";

import {
  LoadingIndicators,
  createLoadingIndicatorMeta,
  shouldShowTopLoadingBarForQuery,
} from "./loading-indicator-meta.js";

describe("loading indicator meta", () => {
  it("shows the top loading bar for unmarked initial query loads", () => {
    expect(
      shouldShowTopLoadingBarForQuery({
        dataUpdatedAt: 0,
        meta: undefined,
      }),
    ).toBe(true);
  });

  it("does not show the top loading bar for unmarked query refetches after data has loaded", () => {
    expect(
      shouldShowTopLoadingBarForQuery({
        dataUpdatedAt: 1,
        meta: undefined,
      }),
    ).toBe(false);
  });

  it("does not show the top loading bar for queries that opt out", () => {
    expect(
      shouldShowTopLoadingBarForQuery({
        dataUpdatedAt: 0,
        meta: createLoadingIndicatorMeta(LoadingIndicators.NONE),
      }),
    ).toBe(false);
  });

  it("does not show the top loading bar for queries that select another indicator", () => {
    expect(
      shouldShowTopLoadingBarForQuery({
        dataUpdatedAt: 0,
        meta: createLoadingIndicatorMeta(LoadingIndicators.AUTOSAVE),
      }),
    ).toBe(false);
  });
});
