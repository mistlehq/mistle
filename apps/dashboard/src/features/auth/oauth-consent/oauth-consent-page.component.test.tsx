// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "../../../app.js";
import { AppShell } from "../../shell/app-shell.js";
import { RequireAuth } from "../../shell/require-auth.js";
import { OAuthConsentPage, OAuthConsentPageView } from "./oauth-consent-page.js";

describe("OAuthConsentPageView", () => {
  it("lets the user approve a non-empty subset of requested scopes", () => {
    let selectedScopes = new Set(["sandboxProfile:read", "sandboxSession:create"]);
    const approveCalls: string[][] = [];

    const { rerender } = render(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={() => approveCalls.push([...selectedScopes])}
        onDeny={() => {}}
        onSelectedScopesChange={(nextScopes) => {
          selectedScopes = nextScopes;
        }}
        organizationName="Acme"
        requestedScopes={["sandboxProfile:read", "sandboxSession:create"]}
        resource="https://mcp.example.test/mcp"
        selectedScopes={selectedScopes}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "sandboxSession:create" }));
    rerender(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={() => approveCalls.push([...selectedScopes])}
        onDeny={() => {}}
        onSelectedScopesChange={(nextScopes) => {
          selectedScopes = nextScopes;
        }}
        organizationName="Acme"
        requestedScopes={["sandboxProfile:read", "sandboxSession:create"]}
        resource="https://mcp.example.test/mcp"
        selectedScopes={selectedScopes}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(approveCalls).toStrictEqual([["sandboxProfile:read"]]);
  });

  it("disables approval when every requested scope is deselected", () => {
    render(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={() => {}}
        onDeny={() => {}}
        onSelectedScopesChange={() => {}}
        organizationName="Acme"
        requestedScopes={["sandboxProfile:read"]}
        resource="https://mcp.example.test/mcp"
        selectedScopes={new Set()}
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
  });
});

describe("OAuth consent route", () => {
  it("is protected by RequireAuth without rendering inside AppShell", () => {
    const matches = matchRoutes(APP_ROUTES, "/auth/oauth/consent/request_123");
    if (matches === null) {
      throw new Error("Expected OAuth consent route to match.");
    }

    const elementTypes = matches.map((match) =>
      isValidElement(match.route.element) ? match.route.element.type : null,
    );
    expect(elementTypes).toContain(RequireAuth);
    expect(elementTypes).toContain(OAuthConsentPage);
    expect(elementTypes).not.toContain(AppShell);
  });
});
