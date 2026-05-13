import { PostHogProvider } from "@posthog/react";
import posthog, { type PostHog } from "posthog-js";
import { createContext, useContext, useMemo } from "react";

import { getDashboardConfig, type DashboardPostHogConfig } from "../../config.js";

type Analytics = {
  readonly identifyAuthenticatedContext: (input: {
    userId: string;
    organizationId: string;
  }) => void;
  readonly captureDashboardPageView: (input: { pathname: string; organizationId: string }) => void;
};

const DisabledAnalytics: Analytics = {
  identifyAuthenticatedContext: () => {},
  captureDashboardPageView: () => {},
};

const AnalyticsContext = createContext<Analytics>(DisabledAnalytics);

let initializedPostHogClient: PostHog | undefined;

function resolvePostHogClient(config: DashboardPostHogConfig): PostHog | undefined {
  if (!config.enabled) {
    return undefined;
  }

  if (initializedPostHogClient === undefined) {
    initializedPostHogClient = posthog.init(config.projectApiKey, {
      api_host: config.host,
      capture_pageview: false,
      autocapture: false,
      disable_session_recording: true,
      defaults: "2026-01-30",
    });
  }

  return initializedPostHogClient;
}

function createPostHogAnalytics(client: PostHog): Analytics {
  return {
    identifyAuthenticatedContext: ({ userId, organizationId }) => {
      client.identify(userId);
      client.group("organization", organizationId);
    },
    captureDashboardPageView: ({ pathname, organizationId }) => {
      client.capture("dashboard_page_view", {
        pathname,
        organization_id: organizationId,
      });
    },
  };
}

export function AnalyticsProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const client = resolvePostHogClient(getDashboardConfig().posthog);
  const analytics = useMemo(
    () => (client === undefined ? DisabledAnalytics : createPostHogAnalytics(client)),
    [client],
  );
  const children =
    client === undefined ? (
      props.children
    ) : (
      <PostHogProvider client={client}>{props.children}</PostHogProvider>
    );

  return <AnalyticsContext.Provider value={analytics}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): Analytics {
  return useContext(AnalyticsContext);
}
