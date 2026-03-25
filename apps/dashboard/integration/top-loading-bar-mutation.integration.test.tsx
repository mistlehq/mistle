// @vitest-environment jsdom

import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { SaveActions } from "../src/features/settings/save-actions.js";
import { TopLoadingBar } from "../src/features/shell/top-loading-bar.js";
import { createTestQueryClient } from "../src/test-support/query-client.js";

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

function SettingsMutationFlowPage(input: { pendingMutation: Promise<string> }): React.JSX.Element {
  const [hasDirtyChanges, setHasDirtyChanges] = useState(true);
  const mutation = useMutation({
    mutationFn: async () => input.pendingMutation,
    onSuccess: () => {
      setHasDirtyChanges(false);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <TopLoadingBar />
      <SaveActions
        cancelDisabled={!hasDirtyChanges || mutation.isPending}
        onCancel={() => setHasDirtyChanges(false)}
        onSave={() => {
          void mutation.mutateAsync();
        }}
        saveDisabled={!hasDirtyChanges || mutation.isPending}
        saveSuccess={mutation.isSuccess}
        saving={mutation.isPending}
      />
    </div>
  );
}

describe("top loading bar integration mutation flow", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows progress while a page mutation is pending and hides after completion", async () => {
    const queryClient = createTestQueryClient();
    const pendingMutation = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<SettingsMutationFlowPage pendingMutation={pendingMutation.promise} />}
          path="/"
        />,
      ),
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("progressbar", { name: "Loading" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeTruthy();

    pendingMutation.resolve("done");

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });
  });
});
