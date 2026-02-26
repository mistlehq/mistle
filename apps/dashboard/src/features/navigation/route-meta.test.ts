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
          breadcrumb: "Providers",
          breadcrumbTo: "/settings/organization/providers",
        },
        params: {},
        pathname: "/settings/organization/providers",
      },
      {
        handle: {
          breadcrumb: ({ params }: { params: Readonly<Record<string, string | undefined>> }) =>
            `${params["providerId"] ?? "provider"} callback`,
        },
        params: {
          providerId: "github",
        },
        pathname: "/settings/organization/providers/github/callback-result",
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
        label: "Providers",
        to: "/settings/organization/providers",
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
});
