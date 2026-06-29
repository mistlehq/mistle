import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "./app.js";
import { AUTH_CREATE_ORGANIZATION_PATH } from "./features/auth/auth-create-organization-page.js";

describe("app routes", () => {
  it("registers the authenticated organization creation route", () => {
    const matches = matchRoutes(APP_ROUTES, AUTH_CREATE_ORGANIZATION_PATH);
    const leafRoute = matches?.at(-1)?.route;

    expect(leafRoute?.path).toBe(AUTH_CREATE_ORGANIZATION_PATH);
  });

  it("routes Port Access links through the authenticated dashboard flow", () => {
    const matches = matchRoutes(APP_ROUTES, "/p/ports/AbCdEf123456");
    const leafRoute = matches?.at(-1)?.route;

    expect(leafRoute?.path).toBe("/p/ports/:slug");
  });

  it("does not expose the temporarily hidden organization sandbox settings route", () => {
    const matches = matchRoutes(APP_ROUTES, "/settings/organization/sandboxes");
    const leafRoute = matches?.at(-1)?.route;

    expect(leafRoute?.path).toBe("*");
  });
});
