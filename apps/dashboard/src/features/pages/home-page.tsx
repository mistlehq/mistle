import { Notice } from "@mistle/ui";
import * as React from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useDashboardCapabilitiesQuery } from "../dashboard/dashboard-capabilities-query.js";
import { useHomeSummary } from "../home/use-home-summary.js";
import { PageFrame } from "../shared/page-frame.js";
import { HomePageFrame } from "./home-page-frame.js";
import { createHomeOnboardingViewModel } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";
import { NewSessionForm } from "./new-session-form.js";

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate();
  const homeSummaryQuery = useHomeSummary();
  const dashboardCapabilitiesQuery = useDashboardCapabilitiesQuery();

  if (homeSummaryQuery.isError) {
    return (
      <PageFrame width="normal" title="Get started">
        <Notice title="Could not load home" variant="alert">
          {resolveApiErrorMessage({
            error: homeSummaryQuery.error,
            fallbackMessage: "Could not load home summary.",
          })}
        </Notice>
      </PageFrame>
    );
  }

  if (homeSummaryQuery.isPending || homeSummaryQuery.data === undefined) {
    return (
      <PageFrame width="normal" title="Get started">
        {null}
      </PageFrame>
    );
  }

  const onboarding = createHomeOnboardingViewModel(homeSummaryQuery.data.onboarding);

  return (
    <HomePageFrame
      onboardingState={onboarding.state}
      showMistleCloudBetaNotice={dashboardCapabilitiesQuery.data?.billing?.stripe.enabled === true}
    >
      <HomePageView
        createSessionForm={<NewSessionForm />}
        onboarding={onboarding}
        onNavigate={(href) => {
          void navigate(href);
        }}
        recentSessions={homeSummaryQuery.data.recentSessions}
      />
    </HomePageFrame>
  );
}
