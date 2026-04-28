// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { NavigationBlockerDialog } from "./navigation-blocker-dialog.js";

afterEach(() => {
  cleanup();
});

function GuardHarness(): React.JSX.Element {
  const [isBlocking, setIsBlocking] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <NavigationBlockerDialog enabled={isBlocking} />
      <p>Current route: {location.pathname}</p>
      <button
        onClick={() => {
          setIsBlocking(true);
        }}
        type="button"
      >
        Enable blocking
      </button>
      <button
        onClick={() => {
          void navigate("/next");
        }}
        type="button"
      >
        Navigate away
      </button>
    </div>
  );
}

function NextPage(): React.JSX.Element {
  return <p>Next page</p>;
}

describe("NavigationBlockerDialog", () => {
  it("blocks in-app navigation until the user confirms discarding changes", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <GuardHarness />,
        },
        {
          path: "/next",
          element: <NextPage />,
        },
      ],
      {
        initialEntries: ["/"],
      },
    );

    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: "Enable blocking" }));
    fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeDefined();
    expect(screen.getByText("Current route: /")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Stay on page" }));

    await waitFor(() => {
      expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
      expect(screen.getByText("Current route: /")).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    await waitFor(() => {
      expect(screen.getByText("Next page")).toBeDefined();
    });
  });

  it("registers a browser unload prompt only while navigation blocking is enabled", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <GuardHarness />,
        },
      ],
      {
        initialEntries: ["/"],
      },
    );

    render(<RouterProvider router={router} />);

    const unblockedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unblockedEvent);
    expect(unblockedEvent.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Enable blocking" }));

    const blockedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(blockedEvent);

    expect(blockedEvent.defaultPrevented).toBe(true);
  });

  it("resets the blocked navigation when the dialog is dismissed with escape", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: <GuardHarness />,
        },
        {
          path: "/next",
          element: <NextPage />,
        },
      ],
      {
        initialEntries: ["/"],
      },
    );

    render(<RouterProvider router={router} />);

    fireEvent.click(screen.getByRole("button", { name: "Enable blocking" }));
    fireEvent.click(screen.getByRole("button", { name: "Navigate away" }));

    expect(screen.getByText("Discard unsaved changes?")).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("Discard unsaved changes?")).toBeNull();
      expect(screen.getByText("Current route: /")).toBeDefined();
    });
  });
});
