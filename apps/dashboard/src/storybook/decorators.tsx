import { Toaster } from "@mistle/ui";
import type { Decorator } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

export const withDashboardCenteredStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <Story />
      </div>
    </div>
  );
};

export const withDashboardPageStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="min-h-screen">
      <Story />
      <Toaster position="top-right" />
    </div>
  );
};

export const withDashboardWorkspaceStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="h-screen overflow-hidden">
      <Story />
    </div>
  );
};

export function createDashboardMemoryRouterDecorator(
  initialEntries?: readonly string[],
): Decorator {
  return (Story): React.JSX.Element => {
    if (initialEntries === undefined) {
      return (
        <MemoryRouter>
          <Story />
        </MemoryRouter>
      );
    }

    return (
      <MemoryRouter initialEntries={[...initialEntries]}>
        <Story />
      </MemoryRouter>
    );
  };
}

export const withDashboardMemoryRouter = createDashboardMemoryRouterDecorator();
