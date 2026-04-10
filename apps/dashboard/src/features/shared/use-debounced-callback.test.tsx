// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useDebouncedCallback } from "./use-debounced-callback.js";
import { DEFAULT_SEARCH_DEBOUNCE_MS } from "./use-debounced-value.js";

describe("useDebouncedCallback", () => {
  it("invokes the callback only after the debounce window elapses", async () => {
    const receivedValues: string[] = [];
    const { result } = renderHook(() =>
      useDebouncedCallback((value: string) => {
        receivedValues.push(value);
      }),
    );

    act(() => {
      result.current("alpha");
    });

    expect(receivedValues).toEqual([]);

    await waitFor(
      () => {
        expect(receivedValues).toEqual(["alpha"]);
      },
      {
        timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 300,
      },
    );
  });

  it("publishes only the latest invocation after rapid successive calls", async () => {
    const receivedValues: string[] = [];
    const { result } = renderHook(() =>
      useDebouncedCallback((value: string) => {
        receivedValues.push(value);
      }),
    );

    act(() => {
      result.current("alpha");
      result.current("beta");
      result.current("gamma");
    });

    await waitFor(
      () => {
        expect(receivedValues).toEqual(["gamma"]);
      },
      {
        timeout: DEFAULT_SEARCH_DEBOUNCE_MS + 300,
      },
    );
  });

  it("flushes the pending invocation immediately", async () => {
    const receivedValues: string[] = [];
    const { result } = renderHook(() =>
      useDebouncedCallback((value: string) => {
        receivedValues.push(value);
      }),
    );

    act(() => {
      result.current("alpha");
      result.current.flush();
    });

    expect(receivedValues).toEqual(["alpha"]);
  });
});
