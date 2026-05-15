import { QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  createRoutesFromElements,
  Outlet,
  Route,
  RouterProvider,
} from "react-router";
import { describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import { sandboxInstanceStatusQueryKey } from "../sessions/sessions-query-keys.js";
import { useAppPageBreadcrumbs } from "./app-breadcrumbs.js";
import { ROUTE_HANDLES } from "./route-handles.js";
import { useAppPageMeta } from "./route-meta.js";

function expectMarkupToContainCurrentPageLabel(markup: string, label: string): void {
  expect(markup).toMatch(new RegExp(`aria-current="page"[\\s\\S]*title="${escapeRegExp(label)}"`));
}

function expectMarkupToContainHref(markup: string, href: string): void {
  expect(markup).toContain(`href="${href}"`);
}

function expectMarkupToContainMetaTitle(markup: string, title: string): void {
  expect(markup).toContain(`data-slot="meta-title">${title}`);
}

function expectMarkupToContainMetaDescription(markup: string, description: string): void {
  expect(markup).toContain(`data-slot="meta-description">${description}`);
}

function expectMarkupToContainEmptyMetaDescription(markup: string): void {
  expect(markup).toContain('data-slot="meta-description"></p>');
}

function expectMarkupToContainEmptyMetaTitle(markup: string): void {
  expect(markup).toContain('data-slot="meta-title"></p>');
}

function expectMarkupNotToContainBreadcrumbs(markup: string): void {
  expect(markup).not.toContain('aria-label="Page breadcrumbs"');
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function PageHarness(): React.JSX.Element {
  const breadcrumbs = useAppPageBreadcrumbs();
  const pageMeta = useAppPageMeta();
  return (
    <div>
      {breadcrumbs}
      <p data-slot="meta-title">{pageMeta.title ?? "MISSING_TITLE"}</p>
      <p data-slot="meta-description">{pageMeta.supportingText ?? ""}</p>
    </div>
  );
}

function renderRoutingMarkup(
  router: ReturnType<typeof createMemoryRouter>,
  queryClient = createTestQueryClient(),
): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
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
            element={<PageHarness />}
            handle={ROUTE_HANDLES.settingsOrganizationIdentityLinking}
            path="identity-linking"
          />
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.settingsOrganizationSandboxes}
            path="sandboxes"
          />
        </Route>
      </Route>
    </Route>,
  );

  const integrationRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.integrations} path="integrations">
        <Route element={<PageHarness />} index />
        <Route handle={ROUTE_HANDLES.integrationDetail} path=":targetKey">
          <Route element={<PageHarness />} index />
          <Route element={<PageHarness />} handle={ROUTE_HANDLES.integrationCreate} path="add" />
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.integrationEdit}
            path=":connectionId/edit"
          />
        </Route>
      </Route>
    </Route>,
  );

  const sandboxProfileRoutes = createRoutesFromElements(
    <Route element={<Outlet />} path="/">
      <Route element={<Outlet />} handle={ROUTE_HANDLES.sandboxProfiles} path="sandbox-profiles">
        <Route element={<PageHarness />} index />
        <Route element={<PageHarness />} handle={ROUTE_HANDLES.sandboxProfilesNew} path="new" />
        <Route element={<Outlet />} handle={ROUTE_HANDLES.sandboxProfilesDetail} path=":profileId">
          <Route element={<PageHarness />} index />
          <Route handle={ROUTE_HANDLES.sandboxProfileEditor} path="sandbox-profile">
            <Route element={<PageHarness />} index />
            <Route
              element={<PageHarness />}
              handle={ROUTE_HANDLES.sandboxProfilePublished}
              path="published"
            />
            <Route
              element={<PageHarness />}
              handle={ROUTE_HANDLES.sandboxProfileDraft}
              path="draft"
            />
          </Route>
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.sandboxProfileAutomations}
            path="automations"
          />
          <Route
            element={<PageHarness />}
            handle={ROUTE_HANDLES.sandboxProfileSnapshots}
            path="snapshots"
          />
        </Route>
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
          handle={ROUTE_HANDLES.scheduledAutomationsDetail}
          path="schedules/:automationId"
        />
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
        <Route
          element={<PageHarness />}
          handle={ROUTE_HANDLES.sessionsDetail}
          path=":sandboxInstanceId"
        />
      </Route>
    </Route>,
  );

  it("does not render page breadcrumbs for settings routes", async () => {
    const router = createMemoryRouter(settingsRoutes, {
      initialEntries: ["/settings/account/profile"],
    });
    let markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "My Profile");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/settings/organization/members");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Members");

    await router.navigate("/settings/organization/identity-linking");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Identity Linking");
    expectMarkupToContainMetaDescription(
      markup,
      "Configure the provider apps users will use to link their identities to Mistle.",
    );
  });

  it("updates breadcrumbs across top-level integrations routes", async () => {
    const router = createMemoryRouter(integrationRoutes, {
      initialEntries: ["/integrations"],
    });
    let markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Integrations");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/integrations/github");
    markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/integrations");
    expectMarkupToContainCurrentPageLabel(markup, "GitHub");
    expect(markup).toContain("/integration-logos/github.svg");
    expectMarkupToContainMetaTitle(markup, "GitHub");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/integrations/github/add");
    markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/integrations");
    expectMarkupToContainHref(markup, "/integrations/github");
    expectMarkupToContainCurrentPageLabel(markup, "Add");
    expectMarkupToContainMetaTitle(markup, "Add GitHub Connection");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/integrations/github/icn_123/edit");
    markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/integrations");
    expectMarkupToContainHref(markup, "/integrations/github");
    expectMarkupToContainCurrentPageLabel(markup, "Edit");
    expectMarkupToContainMetaTitle(markup, "Edit GitHub Connection");
    expectMarkupToContainEmptyMetaDescription(markup);
  });

  it("enforces breadcrumb and page metadata coverage for settings destinations", () => {
    const settingsDestinations = [
      "/settings/personal",
      "/settings/organization/general",
      "/settings/organization/members",
      "/settings/organization/identity-linking",
      "/settings/organization/sandboxes",
    ];

    for (const destination of settingsDestinations) {
      const router = createMemoryRouter(settingsRoutes, {
        initialEntries: [destination],
      });
      const markup = renderRoutingMarkup(router);
      expect(markup).not.toContain("MISSING_TITLE");
    }
  });

  it("enforces breadcrumb and page metadata coverage for integrations destinations", () => {
    const integrationDestinations = [
      "/integrations",
      "/integrations/github",
      "/integrations/github/add",
      "/integrations/github/icn_123/edit",
    ];

    for (const destination of integrationDestinations) {
      const router = createMemoryRouter(integrationRoutes, {
        initialEntries: [destination],
      });
      const markup = renderRoutingMarkup(router);
      expect(markup).not.toContain("MISSING_TITLE");
    }
  });

  it("renders sandbox profile breadcrumbs for create routes only", async () => {
    const router = createMemoryRouter(sandboxProfileRoutes, {
      initialEntries: ["/sandbox-profiles/new"],
    });
    let markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/sandbox-profiles");
    expectMarkupToContainCurrentPageLabel(markup, "Create");
    expectMarkupToContainMetaTitle(markup, "Create");
    expectMarkupToContainMetaDescription(markup, "Create a sandbox profile.");

    await router.navigate("/sandbox-profiles/sbp_abc/sandbox-profile/published");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Edit profile");
    expectMarkupToContainMetaDescription(markup, "Edit sandbox profile configuration.");

    await router.navigate("/sandbox-profiles/sbp_draft/sandbox-profile/draft");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Edit profile");
    expectMarkupToContainMetaDescription(markup, "Edit sandbox profile configuration.");

    await router.navigate("/sandbox-profiles/sbp_abc/snapshots");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Edit profile");
    expectMarkupToContainMetaDescription(markup, "Manage sandbox profile snapshots.");
  });

  it("does not render page breadcrumbs for home and sessions routes", async () => {
    const router = createMemoryRouter(dashboardRoutes, {
      initialEntries: ["/"],
    });
    let markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Home");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/sessions");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Sessions");
    expectMarkupToContainEmptyMetaDescription(markup);

    await router.navigate("/sessions/new");
    markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "New session");
    expectMarkupToContainMetaDescription(
      markup,
      "Start a sandbox-backed session from a sandbox profile.",
    );
  });

  it("does not render page breadcrumbs for session detail routes", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      id: "sbi_123",
      title: "Investigate flaky title rendering",
      status: "running",
      connectable: true,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: null,
      startupOperation: null,
    });
    const router = createMemoryRouter(dashboardRoutes, {
      initialEntries: ["/sessions/sbi_123"],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expectMarkupNotToContainBreadcrumbs(markup);
    expect(markup).not.toContain("Investigate flaky title rendering");
    expect(markup).not.toContain("sbi_123");
    expect(markup).not.toContain('href="/sessions"');
    expectMarkupToContainMetaTitle(markup, "Session");
  });

  it("does not render untitled page breadcrumbs for untitled session detail routes", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(sandboxInstanceStatusQueryKey("sbi_123"), {
      id: "sbi_123",
      title: null,
      status: "running",
      connectable: true,
      failureCode: null,
      failureMessage: null,
      runtimeContext: null,
      automationConversation: null,
      startupOperation: null,
    });
    const router = createMemoryRouter(dashboardRoutes, {
      initialEntries: ["/sessions/sbi_123"],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expectMarkupNotToContainBreadcrumbs(markup);
    expect(markup).not.toContain('placeholder="Untitled"');
    expect(markup).not.toContain("sbi_123");
    expect(markup).not.toContain('href="/sessions"');
  });

  it("leaves page breadcrumbs blank while the session detail title is unresolved", () => {
    const queryClient = createTestQueryClient();
    const router = createMemoryRouter(dashboardRoutes, {
      initialEntries: ["/sessions/sbi_123"],
    });

    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expectMarkupNotToContainBreadcrumbs(markup);
    expect(markup).not.toContain('aria-label="Session title"');
    expect(markup).not.toContain('placeholder="Untitled"');
    expect(markup).not.toContain("sbi_123");
    expect(markup).not.toContain('href="/sessions"');
    expect(markup).toContain('data-slot="meta-title">Session');
  });

  it("renders automations breadcrumbs for create and detail routes", async () => {
    const router = createMemoryRouter(automationRoutes, {
      initialEntries: ["/automations"],
    });
    let markup = renderRoutingMarkup(router);

    expectMarkupNotToContainBreadcrumbs(markup);
    expectMarkupToContainMetaTitle(markup, "Triggers");
    expectMarkupToContainMetaDescription(markup, "Manage triggers.");

    await router.navigate("/automations/new");
    markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/automations");
    expectMarkupToContainCurrentPageLabel(markup, "Create");
    expectMarkupToContainMetaTitle(markup, "Create trigger");
    expect(markup).not.toContain("Create a webhook trigger.");

    await router.navigate("/automations/aut_123");
    markup = renderRoutingMarkup(router);

    expectMarkupToContainHref(markup, "/automations");
    expectMarkupToContainCurrentPageLabel(markup, "Edit");
    expect(markup).not.toContain("aut_123");
    expectMarkupToContainEmptyMetaTitle(markup);
    expectMarkupToContainEmptyMetaDescription(markup);
  });

  it("does not render supporting description text for create trigger", () => {
    const router = createMemoryRouter(automationRoutes, {
      initialEntries: ["/automations/new"],
    });
    const markup = renderRoutingMarkup(router);

    expectMarkupToContainMetaTitle(markup, "Create trigger");
    expectMarkupToContainEmptyMetaDescription(markup);
    expect(markup).not.toContain("Create a webhook trigger.");
  });
});
