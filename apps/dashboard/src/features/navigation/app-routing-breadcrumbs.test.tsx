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
      <p data-slot="meta-description">{pageMeta.supportingText ?? "MISSING_DESCRIPTION"}</p>
    </div>
  );
}

describe("app routing breadcrumb integration", () => {
  const settingsRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.settings} path="settings">
        <Route element={<PageHarness />} handle={ROUTE_HANDLES.settingsPersonal} path="personal" />
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
        </Route>
      </Route>
    </Route>,
  );

  const integrationRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="integrations">
        <Route element={<PageHarness />} index />
        <Route
          element={<PageHarness />}
          handle={ROUTE_HANDLES.integrationDetail}
          path=":targetKey"
        />
        <Route
          element={<PageHarness />}
          handle={ROUTE_HANDLES.integrationCallbackResult}
          path=":targetKey/callback-result"
        />
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

  const automationRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.automations} path="automations">
        <Route element={<PageHarness />} index />
        <Route element={<PageHarness />} handle={ROUTE_HANDLES.automationsNew} path="new" />
        <Route
          element={<PageHarness />}
          handle={ROUTE_HANDLES.automationsDetail}
          path=":automationId"
        />
      </Route>
    </Route>,
  );

  const dashboardRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<PageHarness />} handle={ROUTE_HANDLES.dashboard} index />
      <Route element={<Outlet />} handle={ROUTE_HANDLES.sessions} path="sessions">
        <Route element={<PageHarness />} index />
        <Route element={<PageHarness />} handle={ROUTE_HANDLES.sessionsNew} path="new" />
      </Route>
    </Route>,
  );

  it("updates breadcrumbs when moving across settings routes and respects click targets", async () => {
    const router = createMemoryRouter(settingsRoutes, {
      initialEntries: ["/settings/personal"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Settings");
    expect(markup).toContain("Personal");
    expect(markup).toContain("meta-title");
    expect(markup).toContain("Personal");
    expect(markup).toContain('data-slot="meta-description"></p>');

    await router.navigate("/settings/organization/members");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/settings/organization/general"');
    expect(markup).toContain("Members");
    expect(markup).toContain('data-slot="meta-title">Members');
  });

  it("updates breadcrumbs across top-level integrations routes", async () => {
    const router = createMemoryRouter(integrationRoutes, {
      initialEntries: ["/integrations"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Integrations");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-slot="meta-title">Integrations');
    expect(markup).toContain('data-slot="meta-description"></p>');

    await router.navigate("/integrations/github/callback-result");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/integrations"');
    expect(markup).toContain("Github callback");
    expect(markup).toContain("Integration callback result");
    expect(markup).toContain("Review integration connection callback outcome.");

    await router.navigate("/integrations");
    expect(router.state.location.pathname).toBe("/integrations");

    await router.navigate("/integrations/github");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/integrations"');
    expect(markup).toContain("Github");
    expect(markup).toContain('data-slot="meta-title">GitHub');
    expect(markup).toContain('data-slot="meta-description">github');
  });

  it("enforces breadcrumb and page metadata coverage for settings destinations", () => {
    const settingsDestinations = [
      "/settings/personal",
      "/settings/organization/general",
      "/settings/organization/members",
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

  it("enforces breadcrumb and page metadata coverage for integrations destinations", () => {
    const integrationDestinations = [
      "/integrations",
      "/integrations/github",
      "/integrations/github/callback-result",
    ];

    for (const destination of integrationDestinations) {
      const router = createMemoryRouter(integrationRoutes, {
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

    await router.navigate("/sandbox-profiles/sbp_abc");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/sandbox-profiles"');
    expect(markup).toContain("Sandbox Profiles");
    expect(markup).toContain("Edit profile");
    expect(markup).not.toContain("sbp_abc");
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

    await router.navigate("/sessions/new");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/sessions"');
    expect(markup).toContain("New");
    expect(markup).toContain('data-slot="meta-title">New session');
    expect(markup).toContain("Start a sandbox-backed session from a sandbox profile.");
  });

  it("renders automations breadcrumbs for list, create, and detail routes", async () => {
    const router = createMemoryRouter(automationRoutes, {
      initialEntries: ["/automations"],
    });
    let markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain("Automations");
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('data-slot="meta-title">Automations');
    expect(markup).toContain("Manage webhook automations.");

    await router.navigate("/automations/new");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/automations"');
    expect(markup).toContain("Create");
    expect(markup).toContain('data-slot="meta-title">Create automation');
    expect(markup).not.toContain("Create a webhook automation.");

    await router.navigate("/automations/aut_123");
    markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('href="/automations"');
    expect(markup).toContain("Edit automation");
    expect(markup).not.toContain("aut_123");
    expect(markup).toContain('data-slot="meta-title"></p>');
    expect(markup).toContain('data-slot="meta-description"></p>');
  });

  it("does not render supporting description text for create automation", () => {
    const router = createMemoryRouter(automationRoutes, {
      initialEntries: ["/automations/new"],
    });
    const markup = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(markup).toContain('data-slot="meta-title">Create automation');
    expect(markup).toContain('data-slot="meta-description"></p>');
    expect(markup).not.toContain("Create a webhook automation.");
  });
});
