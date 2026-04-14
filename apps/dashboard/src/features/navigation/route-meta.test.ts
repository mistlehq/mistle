import { describe, expect, it } from "vitest";

import {
  resolveAppBreadcrumbsFromMatches,
  resolveAppHeaderLeadingModelFromMatches,
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
      appShellInsetOwner: "child",
      appShellViewportMode: "workspace",
      title: "Create automation",
      headerIcon: null,
      supportingText: "",
    });
  });

  it("resolves breadcrumb header-leading content when no custom override is present", () => {
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
      kind: "breadcrumbs",
      breadcrumbs: [
        {
          isCurrent: false,
          label: "Settings",
          to: "/settings",
        },
        {
          isCurrent: true,
          label: "Members",
          to: null,
        },
      ],
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
