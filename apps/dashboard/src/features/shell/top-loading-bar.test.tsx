// @vitest-environment jsdom

import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { TopLoadingBar } from "./top-loading-bar.js";

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

function QueryLoadingHarness(props: { promise: Promise<string> }): React.JSX.Element {
  useQuery({
    queryKey: ["top-loading-bar-test"],
    queryFn: async () => props.promise,
  });

  return <TopLoadingBar />;
}

function SuppressedQueryLoadingHarness(props: { promise: Promise<string> }): React.JSX.Element {
  useQuery({
    queryKey: ["top-loading-bar-test", "suppressed"],
    meta: {
      suppressTopLoadingBar: true,
    },
    queryFn: async () => props.promise,
  });

  return <TopLoadingBar />;
}

function MutationLoadingHarness(props: { promise: Promise<string> }): React.JSX.Element {
  const mutation = useMutation({
    mutationFn: async () => props.promise,
  });

  return (
    <>
      <button
        onClick={() => {
          mutation.mutate();
        }}
        type="button"
      >
        Trigger mutation
      </button>
      <TopLoadingBar />
    </>
  );
}

describe("top-loading-bar", () => {
  it("does not render when there is no active navigation or data fetch", () => {
    const queryClient = createTestQueryClient();
    const router = createMemoryRouter(
      createRoutesFromElements(<Route element={<TopLoadingBar />} path="/" />),
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
  });

  it("renders during query fetches and hides after the fetch resolves", async () => {
    const queryClient = createTestQueryClient();
    const pendingQuery = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<QueryLoadingHarness promise={pendingQuery.promise} />} path="/" />,
      ),
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("progressbar", { name: "Loading" })).toBeTruthy();

    pendingQuery.resolve("ready");

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });
  });

  it("does not render for queries that suppress top loading bar activity", async () => {
    const queryClient = createTestQueryClient();
    const pendingQuery = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={<SuppressedQueryLoadingHarness promise={pendingQuery.promise} />}
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

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });

    pendingQuery.resolve("ready");
  });

  it("renders during mutations and hides after the mutation resolves", async () => {
    const queryClient = createTestQueryClient();
    const pendingMutation = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<MutationLoadingHarness promise={pendingMutation.promise} />} path="/" />,
      ),
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger mutation" }));

    expect(await screen.findByRole("progressbar", { name: "Loading" })).toBeTruthy();

    pendingMutation.resolve("done");

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });
  });
});
