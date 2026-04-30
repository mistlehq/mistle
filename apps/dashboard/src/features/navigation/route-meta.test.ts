import { describe, expect, it } from "vitest";

import {
  resolveAppBreadcrumbsFromMatches,
  resolveAppHeaderLeadingModelFromMatches,
  resolveAppPageBreadcrumbModelFromMatches,
  resolveAppPageMetaFromMatches,
} from "./route-meta.js";

describe("route breadcrumb metadata", () => {
  it("keeps non-page group crumbs non-clickable while preserving page breadcrumb", () => {
    const breadcrumbs = resolveAppBreadcrumbsFromMatches([
      {
        handle: {
          breadcrumb: "Settings",
          breadcrumbClickable: false,
        },
        params: {},
        pathname: "/settings",
      },
      {
        handle: {
          breadcrumb: "Account",
          breadcrumbClickable: false,
        },
        params: {},
        pathname: "/settings/account",
      },
      {
        handle: {
          breadcrumb: "Profile",
        },
        params: {},
        pathname: "/settings/account/profile",
      },
    ]);

    expect(breadcrumbs).toEqual([
      {
        isCurrent: false,
        label: "Settings",
        to: null,
      },
      {
        isCurrent: false,
        label: "Account",
        to: null,
      },
      {
        isCurrent: true,
        label: "Profile",
        to: null,
      },
    ]);
  });

  it("allows explicit breadcrumb targets for clickable intermediate crumbs", () => {
    const breadcrumbs = resolveAppBreadcrumbsFromMatches([
      {
        handle: {
          breadcrumb: "Integrations",
        },
        params: {},
        pathname: "/integrations",
      },
      {
        handle: {
          breadcrumb: "Github",
          breadcrumbTo: "/integrations/github",
        },
        params: {},
        pathname: "/integrations/github",
      },
    ]);

    expect(breadcrumbs).toEqual([
      {
        isCurrent: false,
        label: "Integrations",
        to: "/integrations",
      },
      {
        isCurrent: true,
        label: "Github",
        to: null,
      },
    ]);
  });

  it("resolves breadcrumb icons when provided by the route handle", () => {
    const breadcrumbs = resolveAppBreadcrumbsFromMatches([
      {
        handle: {
          breadcrumb: "Integrations",
        },
        params: {},
        pathname: "/integrations",
      },
      {
        handle: {
          breadcrumb: "GitHub Cloud",
          breadcrumbIcon: () => "GitHub icon",
        },
        params: {},
        pathname: "/integrations/github-cloud",
      },
    ]);

    expect(breadcrumbs).toEqual([
      {
        isCurrent: false,
        label: "Integrations",
        to: "/integrations",
      },
      {
        icon: "GitHub icon",
        isCurrent: true,
        label: "GitHub Cloud",
        to: null,
      },
    ]);
  });

  it("throws when breadcrumb resolver throws", () => {
    expect(() =>
      resolveAppBreadcrumbsFromMatches([
        {
          handle: {
            breadcrumb: () => {
              throw new Error("breadcrumb resolver failure");
            },
          },
          params: {},
          pathname: "/settings",
        },
      ]),
    ).toThrow("breadcrumb resolver failure");
  });

  it("throws when page meta resolver throws", () => {
    expect(() =>
      resolveAppPageMetaFromMatches([
        {
          handle: {
            title: () => {
              throw new Error("title resolver failure");
            },
          },
          params: {},
          pathname: "/settings",
        },
      ]),
    ).toThrow("title resolver failure");
  });

  it("defaults custom page headers to absent when no override is present", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            title: "Integrations",
            description: "",
          },
          params: {},
          pathname: "/integrations",
        },
      ]),
    ).toEqual({
      appShellHeaderLeadingVisible: false,
      appShellHeaderVisible: false,
      appShellInsetOwner: "app-shell",
      appShellViewportMode: "document",
      title: "Integrations",
      headerIcon: null,
      supportingText: "",
    });
  });

  it("returns route-level supporting text with page metadata", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            title: "Integration connection",
            description: "github-cloud",
            header: {
              icon: () => "Custom icon",
            },
          },
          params: {},
          pathname: "/integrations/github-cloud",
        },
      ]),
    ).toEqual({
      appShellHeaderLeadingVisible: false,
      appShellHeaderVisible: false,
      appShellInsetOwner: "app-shell",
      appShellViewportMode: "document",
      title: "Integration connection",
      headerIcon: "Custom icon",
      supportingText: "github-cloud",
    });
  });

  it("returns route-level app shell dimension metadata", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            appShellInsetOwner: "child",
            appShellViewportMode: "workspace",
            title: "Create automation",
            description: "",
          },
          params: {},
          pathname: "/automations/new",
        },
      ]),
    ).toEqual({
      appShellHeaderLeadingVisible: false,
      appShellHeaderVisible: false,
      appShellInsetOwner: "child",
      appShellViewportMode: "workspace",
      title: "Create automation",
      headerIcon: null,
      supportingText: "",
    });
  });

  it("defaults app shell header visibility to hidden unless a route opts in", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            breadcrumb: "Integrations",
            title: "Integrations",
          },
          params: {},
          pathname: "/integrations",
        },
      ]),
    ).toMatchObject({
      appShellHeaderLeadingVisible: false,
      appShellHeaderVisible: false,
    });
  });

  it("resolves app shell header visibility from the deepest route opt-in", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            appShellHeaderVisible: false,
            title: "Sessions",
          },
          params: {},
          pathname: "/sessions",
        },
        {
          handle: {
            appShellHeaderLeadingVisible: true,
            appShellHeaderVisible: true,
            title: "Session",
          },
          params: {
            sandboxInstanceId: "sbi_123",
          },
          pathname: "/sessions/sbi_123",
        },
      ]),
    ).toMatchObject({
      appShellHeaderLeadingVisible: true,
      appShellHeaderVisible: true,
    });
  });

  it("allows routes to opt into the app shell header without leading content", () => {
    expect(
      resolveAppPageMetaFromMatches([
        {
          handle: {
            appShellHeaderVisible: true,
            title: "Edit profile",
          },
          params: {},
          pathname: "/sandbox-profiles/sbp_123/sandbox-profile",
        },
      ]),
    ).toMatchObject({
      appShellHeaderLeadingVisible: false,
      appShellHeaderVisible: true,
    });
  });

  it("does not use breadcrumbs as app shell header-leading content", () => {
    expect(
      resolveAppHeaderLeadingModelFromMatches([
        {
          handle: {
            breadcrumb: "Settings",
          },
          params: {},
          pathname: "/settings",
        },
        {
          handle: {
            breadcrumb: "Members",
          },
          params: {},
          pathname: "/settings/members",
        },
      ]),
    ).toEqual({
      kind: "none",
    });
  });

  it("defaults page breadcrumb rendering to hidden unless a route opts in", () => {
    expect(
      resolveAppPageBreadcrumbModelFromMatches([
        {
          handle: {
            breadcrumb: "Integrations",
          },
          params: {},
          pathname: "/integrations",
        },
      ]),
    ).toEqual({
      kind: "none",
    });
  });

  it("inherits page breadcrumb visibility from parent routes", () => {
    expect(
      resolveAppPageBreadcrumbModelFromMatches([
        {
          handle: {
            breadcrumb: "Integrations",
          },
          params: {},
          pathname: "/integrations",
        },
        {
          handle: {
            breadcrumb: "GitHub",
            pageBreadcrumbVisible: true,
          },
          params: {
            targetKey: "github",
          },
          pathname: "/integrations/github",
        },
        {
          handle: {
            breadcrumb: "Add",
          },
          params: {
            targetKey: "github",
          },
          pathname: "/integrations/github/add",
        },
      ]),
    ).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [
        {
          isCurrent: false,
          label: "Integrations",
          to: "/integrations",
        },
        {
          isCurrent: false,
          label: "GitHub",
          to: "/integrations/github",
        },
        {
          isCurrent: true,
          label: "Add",
          to: null,
        },
      ],
    });
  });

  it("uses custom page breadcrumbs when the deepest matching route provides them", () => {
    expect(
      resolveAppPageBreadcrumbModelFromMatches([
        {
          handle: {
            breadcrumb: "Sandbox Profiles",
          },
          params: {},
          pathname: "/sandbox-profiles",
        },
        {
          handle: {
            breadcrumb: "Profile",
            pageBreadcrumbVisible: true,
          },
          params: {
            profileId: "sbp_123",
          },
          pathname: "/sandbox-profiles/sbp_123",
        },
        {
          handle: {
            breadcrumb: "Published",
            pageBreadcrumb: () => "Profile breadcrumb",
          },
          params: {
            profileId: "sbp_123",
          },
          pathname: "/sandbox-profiles/sbp_123/sandbox-profile/published",
        },
      ]),
    ).toEqual({
      kind: "custom",
      content: "Profile breadcrumb",
    });
  });

  it("resolves custom header-leading content from the deepest route handle", () => {
    expect(
      resolveAppHeaderLeadingModelFromMatches([
        {
          handle: {
            breadcrumb: "Sessions",
          },
          params: {},
          pathname: "/sessions",
        },
        {
          handle: {
            header: {
              leading: () => "Session Title",
            },
          },
          params: {
            sandboxInstanceId: "sbx_123",
          },
          pathname: "/sessions/sbx_123",
        },
      ]),
    ).toEqual({
      kind: "custom",
      content: "Session Title",
    });
  });

  it("resolves no header-leading content when routes provide neither breadcrumbs nor overrides", () => {
    expect(
      resolveAppHeaderLeadingModelFromMatches([
        {
          handle: {
            appShellInsetOwner: "child",
          },
          params: {},
          pathname: "/workspace",
        },
      ]),
    ).toEqual({
      kind: "none",
    });
  });
});
