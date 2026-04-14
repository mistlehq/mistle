import { describe, expect, it } from "vitest";

import {
  ROUTE_HANDLES,
  SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT,
  SETTINGS_PAGE_ROUTE_HANDLE_KEYS,
} from "./route-handles.js";

describe("route handles", () => {
  it("defines titles and descriptions for settings leaf pages", () => {
    expect(ROUTE_HANDLES.dashboard.title).toBe("Home");
    expect(ROUTE_HANDLES.dashboard.description).toBe("");
    expect(ROUTE_HANDLES.integrations.title).toBe("Integrations");
    expect(ROUTE_HANDLES.integrations.description).toBe("");
    expect(typeof ROUTE_HANDLES.integrationCreate.title).toBe("function");
    expect(typeof ROUTE_HANDLES.integrationCreate.description).toBe("function");
    expect(ROUTE_HANDLES.integrationCreate.header?.icon).toBeDefined();
    expect(ROUTE_HANDLES.integrationCreate.appShellInsetOwner).toBe("child");
    expect(typeof ROUTE_HANDLES.integrationDetail.title).toBe("function");
    expect(typeof ROUTE_HANDLES.integrationDetail.description).toBe("function");
    expect(ROUTE_HANDLES.integrationDetail.header?.icon).toBeDefined();
    expect(ROUTE_HANDLES.sessions.title).toBe("Sessions");
    expect(ROUTE_HANDLES.sessions.description).toBe("");
    expect(ROUTE_HANDLES.sessionsNew.title).toBe("New session");
    expect(ROUTE_HANDLES.sessionsNew.description).toBe(
      "Start a sandbox-backed session from a sandbox profile.",
    );
    expect(ROUTE_HANDLES.sessionsNew.appShellInsetOwner).toBe("child");
    expect(ROUTE_HANDLES.sessionsDetail.title).toBe("Session");
    expect(ROUTE_HANDLES.sessionsDetail.description).toBe(
      "Interact with one sandbox-backed Codex session.",
    );

    expect(ROUTE_HANDLES.sandboxProfiles.title).toBe("Sandbox Profiles");
    expect(ROUTE_HANDLES.sandboxProfiles.description).toBe("Manage sandbox profile configuration.");
    expect(ROUTE_HANDLES.sandboxProfilesNew.title).toBe("Create");
    expect(ROUTE_HANDLES.sandboxProfilesNew.description).toBe("Create a sandbox profile.");
    expect(ROUTE_HANDLES.sandboxProfilesNew.appShellInsetOwner).toBe("child");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.title).toBe("Edit profile");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.description).toBe(
      "Edit sandbox profile configuration.",
    );
    expect(ROUTE_HANDLES.sandboxProfilesDetail.appShellInsetOwner).toBe("child");

    expect(ROUTE_HANDLES.automations.title).toBe("Automations");
    expect(ROUTE_HANDLES.automations.description).toBe("Manage webhook automations.");
    expect(ROUTE_HANDLES.automationsNew.title).toBe("Create automation");
    expect(ROUTE_HANDLES.automationsNew.description).toBe("");
    expect(ROUTE_HANDLES.automationsNew.appShellInsetOwner).toBe("child");
    expect(ROUTE_HANDLES.automationsDetail.title).toBe("");
    expect(ROUTE_HANDLES.automationsDetail.description).toBe("");
    expect(ROUTE_HANDLES.automationsDetail.appShellInsetOwner).toBe("child");

    expect(ROUTE_HANDLES.settingsPersonal.title).toBe("Personal");
    expect(ROUTE_HANDLES.settingsPersonal.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationGeneral.title).toBe("General");
    expect(ROUTE_HANDLES.settingsOrganizationGeneral.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationMembers.title).toBe("Members");
    expect(ROUTE_HANDLES.settingsOrganizationMembers.description).toBe("");

    expect(ROUTE_HANDLES.settingsOrganizationIntegrations.title).toBe("Integrations");
    expect(ROUTE_HANDLES.settingsOrganizationIntegrations.description).toBe("");

    expect(typeof ROUTE_HANDLES.settingsOrganizationIntegrationDetail.title).toBe("function");
    expect(typeof ROUTE_HANDLES.settingsOrganizationIntegrationDetail.description).toBe("function");
    expect(ROUTE_HANDLES.settingsOrganizationIntegrationDetail.header?.icon).toBeDefined();
  });

  it("defines intended breadcrumb clickability for parent crumbs", () => {
    expect(ROUTE_HANDLES.settings.breadcrumbClickable).toBe(false);
    expect(ROUTE_HANDLES.settingsOrganization.breadcrumbTo).toBe("/settings/organization/general");
  });

  it("requires settings page handles to include breadcrumb, title, and description", () => {
    for (const handleName of SETTINGS_PAGE_ROUTE_HANDLE_KEYS) {
      const handle = SETTINGS_PAGE_ROUTE_HANDLE_CONTRACT[handleName];
      expect(handle.breadcrumb).toBeDefined();
      expect(handle.title).toBeDefined();
      expect(handle.description).toBeDefined();
    }
  });

  it("normalizes integration detail breadcrumb labels for known and unknown target keys", () => {
    const detailBreadcrumb = ROUTE_HANDLES.integrationDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("integrationDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { targetKey: "github" } })).toBe("Github");
    expect(detailBreadcrumb({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2",
    );
  });

  it("resolves integration detail titles from known definitions and unknown target keys", () => {
    const detailTitle = ROUTE_HANDLES.integrationDetail.title;
    expect(typeof detailTitle).toBe("function");

    if (typeof detailTitle !== "function") {
      throw new Error("integrationDetail title must be a function");
    }

    expect(detailTitle({ params: { targetKey: "github-cloud" } })).toBe("GitHub");
    expect(detailTitle({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2",
    );
  });

  it("resolves integration create title from the target key", () => {
    const createTitle = ROUTE_HANDLES.integrationCreate.title;
    expect(typeof createTitle).toBe("function");

    if (typeof createTitle !== "function") {
      throw new Error("integrationCreate title must be a function");
    }

    expect(createTitle({ params: { targetKey: "github-cloud" } })).toBe("Add GitHub Connection");
    expect(createTitle({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Add Custom Integration V2 Connection",
    );
  });

  it("resolves integration detail supporting text from the target key", () => {
    const detailDescription = ROUTE_HANDLES.integrationDetail.description;
    expect(typeof detailDescription).toBe("function");

    if (typeof detailDescription !== "function") {
      throw new Error("integrationDetail description must be a function");
    }

    expect(detailDescription({ params: { targetKey: "github-cloud" } })).toBe("github-cloud");
    expect(detailDescription({ params: {} })).toBe("");
  });

  it("resolves sandbox profile detail breadcrumb with edit fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.sandboxProfilesDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("sandboxProfilesDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { profileId: "sbp_123" } })).toBe("Edit profile");
    expect(detailBreadcrumb({ params: {} })).toBe("Edit profile");
  });

  it("defines session detail header-leading content and hides breadcrumbs", () => {
    expect(ROUTE_HANDLES.sessionsDetail.hideBreadcrumb).toBe(true);
    expect(typeof ROUTE_HANDLES.sessionsDetail.header?.leading).toBe("function");
  });

  it("resolves automation detail breadcrumb with edit fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.automationsDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("automationsDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { automationId: "aut_123" } })).toBe("Edit automation");
    expect(detailBreadcrumb({ params: {} })).toBe("Edit automation");
  });
});
