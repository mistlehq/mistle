import type { Meta, StoryObj } from "@storybook/react-vite";

import { RouteErrorBoundaryView, type RouteErrorDisplay } from "./route-error-boundary.js";

type RouteErrorBoundaryViewStoryProps = {
  display: RouteErrorDisplay;
};

const ProductionRefreshDisplay: RouteErrorDisplay = {
  title: "Refresh dashboard",
  description: "Something changed while this tab was open. Refresh to continue.",
  detail: null,
  primaryAction: "refresh",
};

const DevelopmentDiagnosticsDisplay: RouteErrorDisplay = {
  title: "Unexpected application error",
  description: "Something went wrong while loading this page.",
  detail:
    "Error: Error\n\nMessage: Storybook route error\n\nStack:\nError: Storybook route error\n    at RouteErrorBoundaryView.stories.tsx",
  primaryAction: null,
};

const RequestFailedDisplay: RouteErrorDisplay = {
  title: "Request failed",
  description: "The dashboard could not load this data.",
  detail: null,
  primaryAction: null,
};

const SignInRequiredDisplay: RouteErrorDisplay = {
  title: "Sign in required",
  description: "Session expired.",
  detail: null,
  primaryAction: "signIn",
};

const NotFoundDisplay: RouteErrorDisplay = {
  title: "Page not found",
  description: "This page no longer exists.",
  detail: null,
  primaryAction: null,
};

const meta = {
  title: "Dashboard/Shell/RouteErrorBoundaryView",
  component: RouteErrorBoundaryViewStory,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    display: ProductionRefreshDisplay,
  },
} satisfies Meta<typeof RouteErrorBoundaryViewStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ProductionRefresh: Story = {};

export const DevelopmentDiagnostics: Story = {
  args: {
    display: DevelopmentDiagnosticsDisplay,
  },
};

export const RequestFailed: Story = {
  args: {
    display: RequestFailedDisplay,
  },
};

export const SignInRequired: Story = {
  args: {
    display: SignInRequiredDisplay,
  },
};

export const NotFound: Story = {
  args: {
    display: NotFoundDisplay,
  },
};

function RouteErrorBoundaryViewStory(input: RouteErrorBoundaryViewStoryProps): React.JSX.Element {
  return (
    <RouteErrorBoundaryView
      display={input.display}
      onRefresh={handleStoryRefresh}
      onSignIn={handleStorySignIn}
    />
  );
}

function handleStoryRefresh(): void {}

function handleStorySignIn(): void {}
