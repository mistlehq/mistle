// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
  useLocation,
} from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { AUTH_CREATE_ORGANIZATION_PATH } from "../auth/auth-create-organization-page.js";
import type { SessionData } from "../auth/types.js";
import {
  DesignerLandingPromptHandoffStorageKey,
  type DesignerLandingPromptHandoff,
} from "../designer/designer-landing-handoff.js";
import { isRecord } from "../shared/is-record.js";
import { RequireAuth } from "./require-auth.js";
import { SESSION_QUERY_KEY } from "./session-query-key.js";

function renderRequireAuthRoute(input: { initialPath: string; sessionData: SessionData }): void {
  const queryClient = createTestQueryClient({
    refetchOnMount: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
  queryClient.setQueryData(SESSION_QUERY_KEY, input.sessionData);
  const router = createMemoryRouter(
    createRoutesFromElements(
      <>
        <Route element={<RequireAuth />}>
          <Route element={<Outlet />}>
            <Route element={<RouteProbe label="root-route" />} path="/" />
            <Route element={<RouteProbe label="settings-route" />} path="/settings" />
          </Route>
        </Route>
        <Route element={<LoginProbe />} path="/auth/login" />
        <Route
          element={<RouteProbe label="create-organization-route" />}
          path={AUTH_CREATE_ORGANIZATION_PATH}
        />
      </>,
    ),
    {
      initialEntries: [input.initialPath],
    },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function RouteProbe(input: { label: string }): React.JSX.Element {
  return <span>{input.label}</span>;
}

function LoginProbe(): React.JSX.Element {
  const location = useLocation();
  return (
    <>
      <span>login-route</span>
      <span data-testid="login-from-pathname">
        {resolveFromLocationStatePathname(location.state)}
      </span>
      <span data-testid="login-from-search">{resolveFromLocationStateSearch(location.state)}</span>
    </>
  );
}

function resolveFromLocationStatePathname(state: unknown): string {
  const pathname = readFromLocationStateField(state, "pathname");
  return pathname ?? "missing";
}

function resolveFromLocationStateSearch(state: unknown): string {
  const search = readFromLocationStateField(state, "search");
  return search ?? "missing";
}

function readFromLocationStateField(state: unknown, field: "pathname" | "search"): string | null {
  if (!isRecord(state)) {
    return null;
  }

  const from = Reflect.get(state, "from");
  if (!isRecord(from)) {
    return null;
  }

  const value = Reflect.get(from, field);
  return typeof value === "string" ? value : null;
}

function readStoredLandingHandoff(): DesignerLandingPromptHandoff | null {
  const storedValue = window.sessionStorage.getItem(DesignerLandingPromptHandoffStorageKey);
  if (storedValue === null) {
    return null;
  }

  const parsedValue: unknown = JSON.parse(storedValue);
  if (!isRecord(parsedValue)) {
    return null;
  }

  const expiresAtMs = Reflect.get(parsedValue, "expiresAtMs");
  const idempotencyKey = Reflect.get(parsedValue, "idempotencyKey");
  const prompt = Reflect.get(parsedValue, "prompt");
  if (
    typeof expiresAtMs !== "number" ||
    typeof idempotencyKey !== "string" ||
    typeof prompt !== "string"
  ) {
    return null;
  }

  return {
    expiresAtMs,
    idempotencyKey,
    prompt,
  };
}

describe("RequireAuth landing prompt handoff", () => {
  afterEach(() => {
    window.sessionStorage.removeItem(DesignerLandingPromptHandoffStorageKey);
  });

  it("captures root prompt before redirecting logged-out users to login", async () => {
    renderRequireAuthRoute({
      initialPath: "/?prompt=%20Build%20a%20triage%20agent%20&source=hero",
      sessionData: null,
    });

    await screen.findByText("login-route");

    const handoff = readStoredLandingHandoff();
    expect(handoff?.prompt).toBe("Build a triage agent");
    expect(handoff?.idempotencyKey.length).toBeGreaterThan(0);
    expect(screen.getByTestId("login-from-pathname").textContent).toBe("/");
    expect(screen.getByTestId("login-from-search").textContent).toBe("?source=hero");
  });

  it("shows copy recovery when root prompt capture cannot write temporary storage", async () => {
    const originalSessionStorage = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get(): Storage {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    try {
      renderRequireAuthRoute({
        initialPath: "/?prompt=Build%20a%20triage%20agent",
        sessionData: null,
      });

      expect(await screen.findByText("Temporary storage blocked")).toBeDefined();
      expect(
        screen.getByText(
          "This browser blocked temporary storage, so Mistle can’t carry your prompt through login automatically. Copy the prompt below, log in, then paste it after login.",
        ),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Copy prompt" })).toBeDefined();
      expect(screen.getByRole("textbox", { name: "Prompt to copy" })).toHaveProperty(
        "value",
        "Build a triage agent",
      );
      expect(screen.queryByText("login-route")).toBeNull();
    } finally {
      if (originalSessionStorage === undefined) {
        Reflect.deleteProperty(window, "sessionStorage");
      } else {
        Object.defineProperty(window, "sessionStorage", originalSessionStorage);
      }
    }
  });

  it("does not capture prompt query parameters on non-root routes", async () => {
    renderRequireAuthRoute({
      initialPath: "/settings?prompt=Build",
      sessionData: null,
    });

    await screen.findByText("login-route");

    expect(window.sessionStorage.getItem(DesignerLandingPromptHandoffStorageKey)).toBeNull();
    expect(screen.getByTestId("login-from-pathname").textContent).toBe("/settings");
    expect(screen.getByTestId("login-from-search").textContent).toBe("?prompt=Build");
  });

  it("keeps authenticated root users on the Designer page after capture", async () => {
    renderRequireAuthRoute({
      initialPath: "/?prompt=Build",
      sessionData: {
        session: {
          id: "session-id",
          activeOrganizationId: "org_123",
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          expiresAt: new Date("2026-03-02T00:00:00.000Z"),
          token: "token",
          updatedAt: new Date("2026-03-01T00:00:00.000Z"),
          userId: "user-id",
        },
        user: {
          id: "user-id",
          appearance: "system",
          createdAt: new Date("2026-03-01T00:00:00.000Z"),
          email: "mistle@example.com",
          emailVerified: true,
          image: null,
          name: "Mistle User",
          updatedAt: new Date("2026-03-01T00:00:00.000Z"),
        },
      },
    });

    await waitFor(() => expect(screen.getByText("root-route")).toBeDefined());
    expect(readStoredLandingHandoff()?.prompt).toBe("Build");
  });
});
