import { systemScheduler, type TimerHandle } from "@mistle/time";
import { Button } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { LoadingIndicators, createLoadingIndicatorMeta } from "../shared/loading-indicator-meta.js";
import { TopLoadingBar } from "./top-loading-bar.js";

type DeferredQuery = {
  promise: Promise<string>;
  resolve: (value: string) => void;
};

/**
 * TopLoadingBar renders the dashboard's route and data-loading progress strip.
 *
 * Use the `Interactive` story to review the visual motion: start a load, watch the bar advance
 * while work remains pending, then finish it to verify the completion fill and fade. Use `Finish
 * and restart` to verify that a second load during the hide delay keeps the bar near complete
 * instead of shrinking back to the starting position.
 */
const meta = {
  title: "Dashboard/Shell/TopLoadingBar",
  component: TopLoadingBarStory,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof TopLoadingBarStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Interactive: Story = {};

function TopLoadingBarStory(): React.JSX.Element {
  const [queryClient] = useState(() => createStoryQueryClient());
  const [router] = useState(() =>
    createMemoryRouter([
      {
        element: <TopLoadingBarHarness />,
        path: "/",
      },
    ]),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function TopLoadingBarHarness(): React.JSX.Element {
  const [loadId, setLoadId] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [deferredQuery, setDeferredQuery] = useState(() => createDeferredQuery());
  const restartTimer = useRef<TimerHandle | null>(null);

  useEffect(
    () => () => {
      cancelRestartTimer();
    },
    [],
  );

  useQuery({
    enabled: isActive,
    meta: createLoadingIndicatorMeta(LoadingIndicators.TOP_LOADING_BAR),
    queryFn: async () => deferredQuery.promise,
    queryKey: ["storybook-top-loading-bar", loadId],
  });

  function cancelRestartTimer(): void {
    if (restartTimer.current === null) {
      return;
    }

    systemScheduler.cancel(restartTimer.current);
    restartTimer.current = null;
  }

  function handleFinishLoad(): void {
    deferredQuery.resolve("ready");
    setIsActive(false);
  }

  function startLoad(): void {
    cancelRestartTimer();
    setDeferredQuery(createDeferredQuery());
    setLoadId((current) => current + 1);
    setIsActive(true);
  }

  function handleFinishAndRestartLoad(): void {
    deferredQuery.resolve("ready");
    setIsActive(false);
    restartTimer.current = systemScheduler.schedule(() => {
      restartTimer.current = null;
      startLoad();
    }, 100);
  }

  return (
    <div className="bg-background min-h-screen">
      <TopLoadingBar />
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6">
        <div className="border bg-card p-6 shadow-xs">
          <h1 className="font-semibold text-lg">Top loading bar</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            The active query keeps the bar moving until you finish the load.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button disabled={isActive} onClick={startLoad} type="button">
              Start load
            </Button>
            <Button disabled={!isActive} onClick={handleFinishLoad} type="button" variant="outline">
              Finish load
            </Button>
            <Button
              disabled={!isActive}
              onClick={handleFinishAndRestartLoad}
              type="button"
              variant="outline"
            >
              Finish and restart
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function createDeferredQuery(): DeferredQuery {
  let resolve: DeferredQuery["resolve"] = () => {};
  const promise = new Promise<string>((resolveValue) => {
    resolve = resolveValue;
  });

  return {
    promise,
    resolve,
  };
}

function createStoryQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
      },
    },
  });
}
