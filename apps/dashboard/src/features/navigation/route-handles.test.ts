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
    expect(ROUTE_HANDLES.sessions.title).toBe("Sessions");
    expect(ROUTE_HANDLES.sessions.description).toBe("");
    expect(ROUTE_HANDLES.sessionsDetail.title).toBe("Session");
    expect(ROUTE_HANDLES.sessionsDetail.description).toBe(
      "Interact with one sandbox-backed Codex session.",
    );

    expect(ROUTE_HANDLES.sandboxProfiles.title).toBe("Sandbox Profiles");
    expect(ROUTE_HANDLES.sandboxProfiles.description).toBe("Manage sandbox profile configuration.");
    expect(ROUTE_HANDLES.sandboxProfilesNew.title).toBe("Create");
    expect(ROUTE_HANDLES.sandboxProfilesNew.description).toBe("Create a sandbox profile.");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.title).toBe("Edit profile");
    expect(ROUTE_HANDLES.sandboxProfilesDetail.description).toBe(
      "Edit sandbox profile configuration.",
    );

    expect(ROUTE_HANDLES.automations.title).toBe("Automations");
    expect(ROUTE_HANDLES.automations.description).toBe("Manage webhook automations.");
    expect(ROUTE_HANDLES.automationsNew.title).toBe("Create automation");
    expect(ROUTE_HANDLES.automationsNew.description).toBe("Create a webhook automation.");
    expect(ROUTE_HANDLES.automationsDetail.title).toBe("Edit automation");
    expect(ROUTE_HANDLES.automationsDetail.description).toBe(
      "Edit webhook automation configuration.",
    );

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
    expect(ROUTE_HANDLES.settingsOrganizationIntegrationDetail.headerIcon).toBeDefined();

    expect(ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.title).toBe(
      "Integration callback result",
    );
    expect(ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.description).toBe(
      "Review integration connection callback outcome.",
    );
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

  it("normalizes callback breadcrumb labels for known and unknown integration target keys", () => {
    const callbackBreadcrumb =
      ROUTE_HANDLES.settingsOrganizationIntegrationCallbackResult.breadcrumb;
    expect(typeof callbackBreadcrumb).toBe("function");

    if (typeof callbackBreadcrumb !== "function") {
      throw new Error(
        "settingsOrganizationIntegrationCallbackResult breadcrumb must be a function",
      );
    }

    expect(callbackBreadcrumb({ params: { targetKey: "github" } })).toBe("Github callback");
    expect(callbackBreadcrumb({ params: { targetKey: "openai" } })).toBe("Openai callback");
    expect(callbackBreadcrumb({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2 callback",
    );
  });

  it("normalizes integration detail breadcrumb labels for known and unknown target keys", () => {
    const detailBreadcrumb = ROUTE_HANDLES.settingsOrganizationIntegrationDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("settingsOrganizationIntegrationDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { targetKey: "github" } })).toBe("Github");
    expect(detailBreadcrumb({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2",
    );
  });

  it("resolves integration detail titles from known definitions and unknown target keys", () => {
    const detailTitle = ROUTE_HANDLES.settingsOrganizationIntegrationDetail.title;
    expect(typeof detailTitle).toBe("function");

    if (typeof detailTitle !== "function") {
      throw new Error("settingsOrganizationIntegrationDetail title must be a function");
    }

    expect(detailTitle({ params: { targetKey: "github-cloud" } })).toBe("GitHub");
    expect(detailTitle({ params: { targetKey: "custom-integration_v2" } })).toBe(
      "Custom Integration V2",
    );
  });

  it("resolves integration detail supporting text from the target key", () => {
    const detailDescription = ROUTE_HANDLES.settingsOrganizationIntegrationDetail.description;
    expect(typeof detailDescription).toBe("function");

    if (typeof detailDescription !== "function") {
      throw new Error("settingsOrganizationIntegrationDetail description must be a function");
    }

    expect(detailDescription({ params: { targetKey: "github-cloud" } })).toBe("github-cloud");
    expect(detailDescription({ params: {} })).toBe("");
  });

  it("resolves sandbox profile detail breadcrumb with profile id fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.sandboxProfilesDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("sandboxProfilesDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { profileId: "sbp_123" } })).toBe("sbp_123");
    expect(detailBreadcrumb({ params: {} })).toBe("Profile");
  });

  it("resolves session detail breadcrumb with sandbox instance id fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.sessionsDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("sessionsDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { sandboxInstanceId: "sbox_123" } })).toBe("sbox_123");
    expect(detailBreadcrumb({ params: {} })).toBe("Session");
  });

  it("resolves automation detail breadcrumb with automation id fallback", () => {
    const detailBreadcrumb = ROUTE_HANDLES.automationsDetail.breadcrumb;
    expect(typeof detailBreadcrumb).toBe("function");

    if (typeof detailBreadcrumb !== "function") {
      throw new Error("automationsDetail breadcrumb must be a function");
    }

    expect(detailBreadcrumb({ params: { automationId: "aut_123" } })).toBe("aut_123");
    expect(detailBreadcrumb({ params: {} })).toBe("Automation");
  });
});
