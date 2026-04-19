import { Notice } from "@mistle/ui";
import * as React from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useHomeSummary } from "../home/use-home-summary.js";
import { createHomeOnboardingViewModel } from "./home-page-view-model.js";
import { HomePageShell, HomePageView } from "./home-page-view.js";

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate();
  const homeSummaryQuery = useHomeSummary();

  if (homeSummaryQuery.isError) {
    return (
      <HomePageShell>
        <Notice title="Could not load home" variant="alert">
          {resolveApiErrorMessage({
            error: homeSummaryQuery.error,
            fallbackMessage: "Could not load home summary.",
          })}
        </Notice>
      </HomePageShell>
    );
  }

  if (homeSummaryQuery.isPending || homeSummaryQuery.data === undefined) {
    return <HomePageShell>{null}</HomePageShell>;
  }

  return (
    <HomePageShell>
      <HomePageView
        onboarding={createHomeOnboardingViewModel(homeSummaryQuery.data.onboarding)}
        onNavigate={(href) => {
          void navigate(href);
        }}
      />
    </HomePageShell>
  );
}
