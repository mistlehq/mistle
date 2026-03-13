import { describe, expect, it } from "vitest";

import { resolveAppBreadcrumbsFromMatches, resolveAppPageMetaFromMatches } from "./route-meta.js";

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
          breadcrumb: "Settings",
          breadcrumbClickable: false,
        },
        params: {},
        pathname: "/settings",
      },
      {
        handle: {
          breadcrumb: "Integrations",
          breadcrumbTo: "/settings/organization/integrations",
        },
        params: {},
        pathname: "/settings/organization/integrations",
      },
      {
        handle: {
          breadcrumb: ({ params }: { params: Readonly<Record<string, string | undefined>> }) => {
            return `${params["targetKey"] ?? "integration"} callback`;
          },
        },
        params: {
          targetKey: "github",
        },
        pathname: "/settings/organization/integrations/github/callback-result",
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
        label: "Integrations",
        to: "/settings/organization/integrations",
      },
      {
        isCurrent: true,
        label: "github callback",
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
          pathname: "/settings/organization/integrations",
        },
      ]),
    ).toEqual({
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
            headerIcon: () => "Custom icon",
          },
          params: {},
          pathname: "/settings/organization/integrations/github-cloud",
        },
      ]),
    ).toEqual({
      title: "Integration connection",
      headerIcon: "Custom icon",
      supportingText: "github-cloud",
    });
  });
});
