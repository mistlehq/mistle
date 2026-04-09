import { Notice } from "@mistle/ui";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { useHomeSummary } from "../home/use-home-summary.js";
import { createHomeOnboardingViewModel } from "./home-page-view-model.js";
import { HomePageView } from "./home-page-view.js";

export function HomePage(): React.JSX.Element {
  const navigate = useNavigate();
  const homeSummaryQuery = useHomeSummary();

  if (homeSummaryQuery.isError) {
    return (
      <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className="w-full max-w-4xl">
          <Notice title="Could not load home" variant="alert">
            {resolveApiErrorMessage({
              error: homeSummaryQuery.error,
              fallbackMessage: "Could not load home summary.",
            })}
          </Notice>
        </div>
      </div>
    );
  }

  if (homeSummaryQuery.isPending || homeSummaryQuery.data === undefined) {
    return (
      <div className="flex min-h-full items-center justify-center px-4 py-6">
        <div className="w-full max-w-4xl space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">Get started</h1>
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <HomePageView
      onboarding={createHomeOnboardingViewModel(homeSummaryQuery.data.onboarding)}
      onNavigate={(href) => {
        void navigate(href);
      }}
    />
  );
}
