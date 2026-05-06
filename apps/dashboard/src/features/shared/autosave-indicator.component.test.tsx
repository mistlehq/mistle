// @vitest-environment jsdom

import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { useAutosaveIndicator } from "./autosave-indicator.js";
import { LoadingIndicators, createLoadingIndicatorMeta } from "./loading-indicator-meta.js";

function createDeferredPromise<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((resolveValue) => {
    resolve = resolveValue;
  });

  return {
    promise,
    resolve,
  };
}

function AutosaveIndicatorHarness(input: { children: React.ReactNode }): React.JSX.Element {
  const autosaveIndicator = useAutosaveIndicator({
    minimumVisibleMs: 0,
    showDelayMs: 0,
  });

  return (
    <>
      {input.children}
      <div aria-label="Autosave indicator">{autosaveIndicator}</div>
    </>
  );
}

function MutationHarness(input: {
  autosave: boolean;
  promise: Promise<string>;
}): React.JSX.Element {
  const mutation = useMutation({
    ...(input.autosave
      ? {
          meta: createLoadingIndicatorMeta(LoadingIndicators.AUTOSAVE),
        }
      : {}),
    mutationFn: async () => input.promise,
  });

  return (
    <AutosaveIndicatorHarness>
      <button
        onClick={() => {
          mutation.mutate();
        }}
        type="button"
      >
        Trigger mutation
      </button>
    </AutosaveIndicatorHarness>
  );
}

describe("useAutosaveIndicator", () => {
  it("renders while autosave mutations are pending", async () => {
    const queryClient = createTestQueryClient();
    const pendingMutation = createDeferredPromise<string>();

    render(
      <QueryClientProvider client={queryClient}>
        <MutationHarness autosave={true} promise={pendingMutation.promise} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger mutation" }));

    expect(await screen.findByText("Saving")).toBeTruthy();

    pendingMutation.resolve("done");

    await waitFor(() => {
      expect(screen.queryByText("Saving")).toBeNull();
    });
  });

  it("ignores mutations that are not tagged as autosaves", async () => {
    const queryClient = createTestQueryClient();
    const pendingMutation = createDeferredPromise<string>();

    render(
      <QueryClientProvider client={queryClient}>
        <MutationHarness autosave={false} promise={pendingMutation.promise} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger mutation" }));

    await waitFor(() => {
      expect(screen.queryByText("Saving")).toBeNull();
    });

    pendingMutation.resolve("done");
  });
});
