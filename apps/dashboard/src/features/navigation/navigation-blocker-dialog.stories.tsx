import { Button, Card, CardContent, DetailLabel, Input } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { createElement, useState } from "react";
import { createMemoryRouter, Route, RouterProvider, Routes, useNavigate } from "react-router";

import { withDashboardCenteredStory } from "../../storybook/decorators.js";
import { NavigationBlockerDialog } from "./navigation-blocker-dialog.js";

function NavigationBlockerDialogStoryShell(input: {
  initialBlocking?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const [isBlocking, setIsBlocking] = useState(input.initialBlocking ?? false);
  const [value, setValue] = useState((input.initialBlocking ?? false) ? "Blocking example" : "");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <NavigationBlockerDialog enabled={isBlocking} />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">Navigation Blocker Dialog</h1>
            <p className="text-muted-foreground text-sm">
              Try navigating away to inspect the discard dialog.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <DetailLabel>Example field</DetailLabel>
            <Input
              id="storybook-navigation-blocker-input"
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                setValue(nextValue);
                setIsBlocking(nextValue.trim().length > 0);
              }}
              value={value}
            />
          </div>

          <div>
            <Button
              onClick={() => {
                void navigate("/next");
              }}
              type="button"
            >
              Navigate away
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NavigationBlockerDialogStoryRoutes(input: {
  initialBlocking?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const storyShellProps =
    input.initialBlocking === undefined ? {} : { initialBlocking: input.initialBlocking };

  return (
    <Routes>
      <Route element={<NavigationBlockerDialogStoryShell {...storyShellProps} />} path="/" />
      <Route
        element={
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
            <Card>
              <CardContent className="flex flex-col gap-4 pt-4">
                <h1 className="text-xl font-semibold">Next Route</h1>
                <p className="text-muted-foreground text-sm">
                  Navigation succeeded after the navigation blocker allowed it.
                </p>
                <div>
                  <Button
                    onClick={() => {
                      void navigate("/");
                    }}
                    type="button"
                    variant="outline"
                  >
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        }
        path="/next"
      />
    </Routes>
  );
}

const meta = {
  title: "Dashboard/Navigation/NavigationBlockerDialog",
  decorators: [withDashboardCenteredStory],
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: function RenderStory(): React.JSX.Element {
    const router = createMemoryRouter(
      [
        {
          path: "*",
          element: createElement(NavigationBlockerDialogStoryRoutes, { initialBlocking: true }),
        },
      ],
      {
        initialEntries: ["/"],
      },
    );

    return <RouterProvider router={router} />;
  },
};
