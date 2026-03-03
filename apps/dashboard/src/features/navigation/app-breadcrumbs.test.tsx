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

function BreadcrumbHarness(): React.JSX.Element {
  return <AppBreadcrumbs />;
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

    const markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Settings");
    expect(markup).toContain("Account");
    expect(markup).toContain("Profile");
    expect(markup).not.toContain('href="/settings"');
    expect(markup).not.toContain('href="/settings/account"');
    expect(markup).toContain('aria-label="Settings (not navigable)"');
    expect(markup).toContain('aria-label="Account (not navigable)"');
    expect(markup).toContain('aria-current="page"');
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
  });

  it("renders clickable intermediate crumbs as links", () => {
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
              handle={{ breadcrumb: "Organization", breadcrumbClickable: false }}
              path="organization"
            >
              <Route
                element={<Outlet />}
                handle={{ breadcrumb: "Integrations" }}
                path="integrations"
              >
                <Route
                  element={<BreadcrumbHarness />}
                  handle={{
                    breadcrumb: ({
                      params,
                    }: {
                      params: Readonly<Record<string, string | undefined>>;
                    }) => `${params["targetKey"] ?? "integration"} callback`,
                  }}
                  path=":targetKey/callback-result"
                />
              </Route>
            </Route>
          </Route>
        </Route>,
      ),
      {
        initialEntries: ["/settings/organization/integrations/github/callback-result"],
      },
    );

    const markup = renderToStaticMarkup(<RouterProvider router={router} />);
    expect(markup).toContain('href="/settings/organization/integrations"');
  });
});
