import type { Decorator } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

export const withDashboardCenteredSurface: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="from-background to-muted/20 min-h-screen bg-linear-to-b px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <Story />
      </div>
    </div>
  );
};

export const withDashboardPageWidth: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Story />
    </div>
  );
};

export const withDashboardMemoryRouter: Decorator = (Story): React.JSX.Element => {
  return (
    <MemoryRouter>
      <Story />
    </MemoryRouter>
  );
};
