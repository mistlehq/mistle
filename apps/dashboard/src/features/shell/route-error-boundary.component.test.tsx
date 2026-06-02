import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { HttpApiError } from "../api/http-api-error.js";
import {
  RouteErrorBoundary,
  resolveRouteErrorDisplay,
  shouldRenderRouteErrorDiagnostics,
} from "./route-error-boundary.js";

describe("resolveRouteErrorDisplay", () => {
  it("returns sign-in guidance for 401 route errors", () => {
    const display = resolveRouteErrorDisplay(
      {
        data: { message: "Session expired." },
        internal: false,
        status: 401,
        statusText: "Unauthorized",
      },
      { showDiagnostics: true },
    );

    expect(display.title).toBe("Sign in required");
    expect(display.description).toBe("Session expired.");
    expect(display.primaryAction).toBe("signIn");
    expect(display.detail).toContain("Route error: 401 Unauthorized");
    expect(display.detail).toContain("Session expired.");
  });

  it("returns not found messaging for 404 route errors", () => {
    const display = resolveRouteErrorDisplay(
      {
        data: null,
        internal: false,
        status: 404,
        statusText: "Not Found",
      },
      { showDiagnostics: true },
    );

    expect(display.title).toBe("Page not found");
    expect(display.description).toBe("The requested page could not be found.");
    expect(display.primaryAction).toBeNull();
    expect(display.detail).toContain("Route error: 404 Not Found");
  });

  it("returns request messaging for HTTP API errors", () => {
    const display = resolveRouteErrorDisplay(
      new HttpApiError({
        operation: "redeemPortAccessLink",
        status: 409,
        body: {
          code: "INSTANCE_NOT_RESUMABLE",
          message: "Sandbox instance is not connectable.",
        },
        message: "Sandbox instance is not connectable.",
        code: "INSTANCE_NOT_RESUMABLE",
      }),
      { showDiagnostics: true },
    );

    expect(display.title).toBe("Request failed");
    expect(display.description).toBe("Sandbox instance is not connectable.");
    expect(display.primaryAction).toBeNull();
    expect(display.detail).toContain("Route error: 409 Sandbox instance is not connectable.");
    expect(display.detail).toContain("INSTANCE_NOT_RESUMABLE");
  });

  it("returns user-safe fallback for unknown route response errors", () => {
    const display = resolveRouteErrorDisplay(
      {
        data: null,
        internal: false,
        status: 503,
        statusText: "Service Unavailable",
      },
      { showDiagnostics: true },
    );

    expect(display.title).toBe("Request failed");
    expect(display.description).toBe("Service Unavailable");
    expect(display.primaryAction).toBeNull();
    expect(display.detail).toContain("Route error: 503 Service Unavailable");
  });

  it("includes error detail for regular thrown Error objects in development", () => {
    const display = resolveRouteErrorDisplay(new Error("Context missing"), {
      showDiagnostics: true,
    });

    expect(display.title).toBe("Unexpected application error");
    expect(display.description).toBe("Something went wrong while loading this page.");
    expect(display.primaryAction).toBeNull();
    expect(display.detail).toContain("Error: Error");
    expect(display.detail).toContain("Message: Context missing");
  });

  it("returns refresh guidance for regular thrown Error objects in production", () => {
    const display = resolveRouteErrorDisplay(new Error("Context missing"), {
      showDiagnostics: false,
    });

    expect(display.title).toBe("Refresh dashboard");
    expect(display.description).toBe(
      "Something changed while this tab was open. Refresh to continue.",
    );
    expect(display.primaryAction).toBe("refresh");
    expect(display.detail).toBeNull();
  });

  it("returns refresh guidance for unknown errors in production", () => {
    const display = resolveRouteErrorDisplay("Unknown render failure", {
      showDiagnostics: false,
    });

    expect(display.title).toBe("Refresh dashboard");
    expect(display.description).toBe(
      "Something changed while this tab was open. Refresh to continue.",
    );
    expect(display.primaryAction).toBe("refresh");
    expect(display.detail).toBeNull();
  });

  it("hides diagnostics outside development", () => {
    expect(shouldRenderRouteErrorDiagnostics({ isDevelopment: false })).toBe(false);
  });

  it("shows diagnostics in development", () => {
    expect(shouldRenderRouteErrorDiagnostics({ isDevelopment: true })).toBe(true);
  });
});

describe("RouteErrorBoundary rendering", () => {
  it("hides diagnostics in production and shows them in development", async () => {
    const productionRouter = createMemoryRouter(
      [
        {
          loader: () => {
            throw new Error("Sensitive route error detail");
          },
          element: <div>Route content</div>,
          errorElement: <RouteErrorBoundary runtimeEnv={{ isDevelopment: false }} />,
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );
    await productionRouter.navigate("/");

    const productionMarkup = renderToStaticMarkup(<RouterProvider router={productionRouter} />);
    expect(productionMarkup).not.toContain("<pre");
    expect(productionMarkup).toContain("Refresh dashboard");
    expect(productionMarkup).toContain("Something changed while this tab was open.");
    expect(productionMarkup).toContain("Refresh now");

    const developmentRouter = createMemoryRouter(
      [
        {
          loader: () => {
            throw new Error("Sensitive route error detail");
          },
          element: <div>Route content</div>,
          errorElement: <RouteErrorBoundary runtimeEnv={{ isDevelopment: true }} />,
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );
    await developmentRouter.navigate("/");

    const developmentMarkup = renderToStaticMarkup(<RouterProvider router={developmentRouter} />);
    expect(developmentMarkup).toContain("<pre");
    expect(developmentMarkup).toContain("Unexpected application error");
    expect(developmentMarkup).toContain("Sensitive route error detail");
  });
});
