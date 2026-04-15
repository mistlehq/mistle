import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";

import { AppBreadcrumbs } from "./app-breadcrumbs.js";

function expectMarkupToContainCurrentPageLabel(markup: string, label: string): void {
  expect(markup).toMatch(new RegExp(`aria-current="page"[\\s\\S]*title="${escapeRegExp(label)}"`));
}

function expectMarkupToContainAriaLabel(markup: string, label: string): void {
  expect(markup).toContain(`aria-label="${label}"`);
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function BreadcrumbHarness(): React.JSX.Element {
  return <AppBreadcrumbs />;
}

function renderBreadcrumbMarkup(router: ReturnType<typeof createMemoryRouter>): string {
  const queryClient = new QueryClient();

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("app-breadcrumbs", () => {
  it("renders non-clickable intermediate crumbs as text and only one current page crumb", () => {
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />} path="/">
          <Route
            element={<Outlet />}
            handle={{ breadcrumb: "Settings", breadcrumbClickable: false }}
            path="settings"
          >
            <Route
              element={<Outlet />}
              handle={{ breadcrumb: "Account", breadcrumbClickable: false }}
              path="account"
            >
              <Route
                element={<BreadcrumbHarness />}
                handle={{ breadcrumb: "Profile" }}
                path="profile"
              />
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/settings/account/profile"],
      },
    );

    const markup = renderBreadcrumbMarkup(router);

    expect(markup).not.toContain('href="/settings"');
    expect(markup).not.toContain('href="/settings/account"');
    expectMarkupToContainAriaLabel(markup, "Settings (not navigable)");
    expectMarkupToContainAriaLabel(markup, "Account (not navigable)");
    expectMarkupToContainCurrentPageLabel(markup, "Profile");
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it("renders clickable intermediate crumbs as links", () => {
    const router = createMemoryRouter(
      createRoutesFromElements(
        <Route element={<Outlet />} path="/">
          <Route element={<Outlet />} handle={{ breadcrumb: "Integrations" }} path="integrations">
            <Route
              element={<BreadcrumbHarness />}
              handle={{ breadcrumb: "GitHub", breadcrumbTo: "/integrations/github" }}
              path="github"
            />
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/integrations/github"],
      },
    );

    const markup = renderBreadcrumbMarkup(router);
    expect(markup).toContain('href="/integrations"');
    expect(markup).not.toContain("leading-none");
  });
});
