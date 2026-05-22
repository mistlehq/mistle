import { Notice } from "@mistle/ui";
import type { ReactNode } from "react";

import { PageFrame } from "../shared/page-frame.js";
import type { HomeChecklistState } from "./home-page-view-model.js";

type HomePageFrameProps = {
  children: ReactNode;
  onboardingState: HomeChecklistState;
  showMistleCloudBetaNotice: boolean;
};

export function HomePageFrame(props: HomePageFrameProps): React.JSX.Element {
  const showGetStartedTitle = props.onboardingState !== "completed";
  const showHeaderContent = props.showMistleCloudBetaNotice || showGetStartedTitle;

  return (
    <PageFrame
      width="normal"
      {...(props.onboardingState === "completed" ? { className: "bg-muted/30" } : {})}
      {...(showHeaderContent
        ? {
            titleSlot: (
              <HomePageHeaderContent
                showGetStartedTitle={showGetStartedTitle}
                showMistleCloudBetaNotice={props.showMistleCloudBetaNotice}
              />
            ),
          }
        : {})}
    >
      {props.children}
    </PageFrame>
  );
}

function HomePageHeaderContent(input: {
  showGetStartedTitle: boolean;
  showMistleCloudBetaNotice: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {input.showMistleCloudBetaNotice ? (
        <Notice
          title="Mistle Cloud is in beta - Usage is free, subject to usage limits"
          variant="warning"
        >
          The free tier includes up to 2 concurrent sandboxes, with runtime and instance-size
          limits. During beta, some limits may be higher while we tune capacity.
        </Notice>
      ) : null}
      {input.showGetStartedTitle ? (
        <h1 className="truncate text-xl font-semibold">Get started</h1>
      ) : null}
    </div>
  );
}
