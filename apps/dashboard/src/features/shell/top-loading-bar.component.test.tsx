// @vitest-environment jsdom

import { systemScheduler } from "@mistle/time";
import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, createRoutesFromElements, Route, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import {
  type LoadingIndicator,
  LoadingIndicators,
  createLoadingIndicatorMeta,
} from "../shared/loading-indicator-meta.js";
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

async function waitForSchedulerDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    systemScheduler.schedule(resolve, delayMs);
  });
}

function QueryLoadingHarness(props: {
  initialData?: string;
  indicator?: LoadingIndicator;
  promise: Promise<string>;
  refetchInterval?: number;
}): React.JSX.Element {
  const meta =
    props.indicator === undefined ? undefined : createLoadingIndicatorMeta(props.indicator);
  const query = useQuery({
    queryKey: ["top-loading-bar-test"],
    ...(meta === undefined ? {} : { meta }),
    ...(props.initialData === undefined ? {} : { initialData: props.initialData }),
    queryFn: async () => props.promise,
    ...(props.refetchInterval === undefined ? {} : { refetchInterval: props.refetchInterval }),
  });

  return (
    <>
      <span>{query.isFetching ? "fetching query" : "idle query"}</span>
      <TopLoadingBar />
    </>
  );
}

function MutationLoadingHarness(props: {
  indicator?: LoadingIndicator;
  promise: Promise<string>;
}): React.JSX.Element {
  const mutation = useMutation({
    ...(props.indicator === undefined
      ? {}
      : {
          meta: createLoadingIndicatorMeta(props.indicator),
        }),
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

    const progressBar = await screen.findByRole("progressbar", { name: "Loading" });
    const progressIndicator = progressBar.firstElementChild;
    if (progressIndicator === null) {
      throw new Error("Top loading bar rendered without a progress indicator.");
    }
    expect(progressIndicator.getAttribute("style")).toContain("translate3d(-92%,0,0)");

    pendingQuery.resolve("ready");

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });
  });

  it("does not render when a query resolves before the loading bar show delay", async () => {
    const queryClient = createTestQueryClient();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<QueryLoadingHarness promise={Promise.resolve("ready")} />} path="/" />,
      ),
      { initialEntries: ["/"] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await waitForSchedulerDelay(250);

    expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
  });

  it("does not render for queries that select no shell loading indicator", async () => {
    const queryClient = createTestQueryClient();
    const pendingQuery = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={
            <QueryLoadingHarness
              indicator={LoadingIndicators.NONE}
              promise={pendingQuery.promise}
            />
          }
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

  it("does not render during query refetches after query data is loaded", async () => {
    const queryClient = createTestQueryClient();
    const pendingQuery = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={
            <QueryLoadingHarness
              initialData="loaded"
              promise={pendingQuery.promise}
              refetchInterval={1_000}
            />
          }
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

    expect(await screen.findByText("fetching query")).toBeTruthy();
    await waitForSchedulerDelay(250);

    expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();

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

  it("does not render for mutations that select no shell loading indicator", async () => {
    const queryClient = createTestQueryClient();
    const pendingMutation = createDeferredPromise<string>();
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route
          element={
            <MutationLoadingHarness
              indicator={LoadingIndicators.NONE}
              promise={pendingMutation.promise}
            />
          }
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

    fireEvent.click(screen.getByRole("button", { name: "Trigger mutation" }));

    await waitFor(() => {
      expect(screen.queryByRole("progressbar", { name: "Loading" })).toBeNull();
    });

    pendingMutation.resolve("done");
  });
});
