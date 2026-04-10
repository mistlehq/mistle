// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEFAULT_SEARCH_DEBOUNCE_MS, useDebouncedValue } from "./use-debounced-value.js";

describe("useDebouncedValue", () => {
  it("keeps the previous value until the default debounce window elapses", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: {
        value: "alpha",
      },
    });

    rerender({
      value: "beta",
    });

    expect(result.current).toBe("alpha");

    await waitFor(
      () => {
        expect(result.current).toBe("beta");
      },
      {
        timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 300,
      },
    );
  });

  it("publishes only the latest value after rapid successive updates", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: {
        value: "alpha",
      },
    });

    rerender({
      value: "beta",
    });
    rerender({
      value: "gamma",
    });

    await waitFor(
      () => {
        expect(result.current).toBe("gamma");
      },
      {
        timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 300,
      },
    );
  });
});
