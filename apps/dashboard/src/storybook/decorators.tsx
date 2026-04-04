import type { Decorator } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";

export const withDashboardCenteredStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="from-background to-muted/20 min-h-screen bg-linear-to-b px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <Story />
      </div>
    </div>
  );
};

export const withDashboardPageStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="min-h-screen bg-background">
      <Story />
    </div>
  );
};

export const withDashboardWorkspaceStory: Decorator = (Story): React.JSX.Element => {
  return (
    <div className="h-screen overflow-hidden bg-background">
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
