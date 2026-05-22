import { Notice } from "@mistle/ui";

type HomeOnboardingHeaderTitleProps = {
  showGetStartedTitle: boolean;
};

export function HomeOnboardingHeaderTitle(
  props: HomeOnboardingHeaderTitleProps,
): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Notice
        title="Mistle Cloud is in beta - Usage is free, subject to usage limits"
        variant="warning"
      >
        The free tier includes up to 2 concurrent sandboxes, with runtime and instance-size limits.
        During beta, some limits may be higher while we tune capacity.
      </Notice>
      {props.showGetStartedTitle ? (
        <h1 className="truncate text-xl font-semibold">Get started</h1>
      ) : null}
    </div>
  );
}
