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
import { ROUTE_HANDLES } from "./route-handles.js";
import { useAppPageMeta } from "./route-meta.js";

function PageHarness(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  return (
    <div>
      <AppBreadcrumbs />
      <p data-slot="meta-title">{pageMeta.title ?? "MISSING_TITLE"}</p>
      <p data-slot="meta-description">{pageMeta.description ?? "MISSING_DESCRIPTION"}</p>
    </div>
  );
}

describe("app routing breadcrumb integration", () => {
  const settingsRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.settings} path="settings">
        <Route element={<Outlet />} handle={ROUTE_HANDLES.settingsAccount} path="account">
          <Route element={<PageHarness />} handle={ROUTE_HANDLES.settingsProfile} path="profile" />
        </Route>
        <Route element={<Outlet />} handle={ROUTE_HANDLES.settingsOrganization} path="organization">
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.settingsOrganizationGeneral}
            path="general"
          />
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.settingsOrganizationMembers}
            path="members"
          />
          <Route
            element={<Outlet />}
            handle={ROUTE_HANDLES.settingsOrganizationProviders}
            path="providers"
          >
            <Route element={<PageHarness />} index />
            <Route
              element={<PageHarness />}
              handle={ROUTE_HANDLES.settingsOrganizationProviderCallbackResult}
              path=":providerId/callback-result"
            />
          </Route>
        </Route>
      </Route>
    </Route>,
  );

  const sandboxProfileRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.sandboxProfiles} path="sandbox-profiles">
        <Route element={<PageHarness />} index />
        <Route element={<PageHarness />} handle={ROUTE_HANDLES.sandboxProfilesNew} path="new" />
        <Route
          element={<PageHarness />}
          handle={ROUTE_HANDLES.sandboxProfilesDetail}
          path=":profileId"
        />
      </Route>
    </Route>,
  );

  const dashboardRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<PageHarness />} handle={ROUTE_HANDLES.dashboard} index />
      <Route element={<PageHarness />} handle={ROUTE_HANDLES.sessions} path="sessions" />
    </Route>,
  );

  it("updates breadcrumbs when moving across settings routes and respects click targets", async () => {
    const router = createMemoryRouter(settingsRoutes, {
      initialEntries: ["/settings/account/profile"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Settings");
    expect(markup).toContain("Account");
    expect(markup).toContain("Profile");
    expect(markup).toContain("meta-title");
    expect(markup).toContain("Profile");
    expect(markup).toContain('data-slot="meta-description"></p>');

    await router.navigate("/settings/organization/providers/github/callback-result");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/settings/organization/general"');
    expect(markup).toContain('href="/settings/organization/providers"');
    expect(markup).toContain("GitHub callback");
    expect(markup).toContain("Provider callback result");
    expect(markup).toContain("Review provider connection callback outcome.");

    await router.navigate("/settings/organization/providers");
    expect(router.state.location.pathname).toBe("/settings/organization/providers");
  });

  it("enforces breadcrumb and page metadata coverage for settings destinations", () => {
    const settingsDestinations = [
      "/settings/account/profile",
      "/settings/organization/general",
      "/settings/organization/members",
      "/settings/organization/providers",
      "/settings/organization/providers/github/callback-result",
    ];

    for (const destination of settingsDestinations) {
      const router = createMemoryRouter(settingsRoutes, {
        initialEntries: [destination],
      });
      const markup = renderToStaticMarkup(<RouterProvider router={router} />);
      expect(markup).not.toContain("MISSING_TITLE");
      expect(markup).not.toContain("MISSING_DESCRIPTION");
    }
  });

  it("renders sandbox profile breadcrumbs for list, create, and detail routes", async () => {
    const router = createMemoryRouter(sandboxProfileRoutes, {
      initialEntries: ["/sandbox-profiles/new"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/sandbox-profiles"');
    expect(markup).toContain("Sandbox Profiles");
    expect(markup).toContain("Create");
    expect(markup).toContain('data-slot="meta-title">Create');
    expect(markup).toContain("Create a sandbox profile.");

    await router.navigate("/sandbox-profiles/sandboxProfile_abc");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/sandbox-profiles"');
    expect(markup).toContain("Sandbox Profiles");
    expect(markup).toContain("sandboxProfile_abc");
    expect(markup).toContain('data-slot="meta-title">Edit profile');
    expect(markup).toContain("Edit sandbox profile configuration.");
  });

  it("renders home and sessions breadcrumbs", async () => {
    const router = createMemoryRouter(dashboardRoutes, {
      initialEntries: ["/"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Home");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-slot="meta-title">Home');
    expect(markup).toContain('data-slot="meta-description"></p>');

    await router.navigate("/sessions");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Sessions");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-slot="meta-title">Sessions');
    expect(markup).toContain('data-slot="meta-description"></p>');
  });
});
