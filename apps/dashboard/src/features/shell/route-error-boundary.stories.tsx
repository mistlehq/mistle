import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";

import type { RuntimeEnv } from "../../lib/runtime-env.js";
import { HttpApiError } from "../api/http-api-error.js";
import { RouteErrorBoundary } from "./route-error-boundary.js";

type RouteErrorBoundaryStoryProps = {
  errorScenario: RouteErrorScenario;
  runtimeEnv: RuntimeEnv;
};

type RouteErrorScenario = "unexpected" | "requestFailed" | "signInRequired" | "notFound";

/**
 * RouteErrorBoundary renders the dashboard's terminal route-error state.
 *
 * Use these stories to compare the production refresh recovery for unexpected errors against the
 * existing request, auth, and not-found route-error states.
 */
const meta = {
  title: "Dashboard/Shell/RouteErrorBoundary",
  component: RouteErrorBoundaryStory,
  parameters: {
    layout: "fullscreen",
  },
  args: {
    errorScenario: "unexpected",
    runtimeEnv: { isDevelopment: false },
  },
} satisfies Meta<typeof RouteErrorBoundaryStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ProductionRefresh: Story = {};

export const DevelopmentDiagnostics: Story = {
  args: {
    errorScenario: "unexpected",
    runtimeEnv: { isDevelopment: true },
  },
};

export const RequestFailed: Story = {
  args: {
    errorScenario: "requestFailed",
    runtimeEnv: { isDevelopment: false },
  },
};

export const SignInRequired: Story = {
  args: {
    errorScenario: "signInRequired",
    runtimeEnv: { isDevelopment: false },
  },
};

export const NotFound: Story = {
  args: {
    errorScenario: "notFound",
    runtimeEnv: { isDevelopment: false },
  },
};

function RouteErrorBoundaryStory(input: RouteErrorBoundaryStoryProps): React.JSX.Element {
  const router = useMemo(
    () =>
      createMemoryRouter(
        [
          {
            loader: () => {
              throw createStoryRouteError(input.errorScenario);
            },
            element: <div>Route content</div>,
            errorElement: <RouteErrorBoundary runtimeEnv={input.runtimeEnv} />,
            path: "/",
          },
        ],
        { initialEntries: ["/"] },
      ),
    [input.errorScenario, input.runtimeEnv],
  );

  return <RouterProvider router={router} />;
}

function createStoryRouteError(scenario: RouteErrorScenario): unknown {
  if (scenario === "requestFailed") {
    return new HttpApiError({
      operation: "loadStorybookRoute",
      status: 500,
      body: { message: "The dashboard could not load this data." },
      message: "The dashboard could not load this data.",
    });
  }

  if (scenario === "signInRequired") {
    return new Response(JSON.stringify({ message: "Session expired." }), {
      headers: { "content-type": "application/json" },
      status: 401,
      statusText: "Unauthorized",
    });
  }

  if (scenario === "notFound") {
    return new Response(JSON.stringify({ message: "This page no longer exists." }), {
      headers: { "content-type": "application/json" },
      status: 404,
      statusText: "Not Found",
    });
  }

  return new Error("Storybook route error");
}
