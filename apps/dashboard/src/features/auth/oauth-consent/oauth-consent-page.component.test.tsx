// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { useState } from "react";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";

import { APP_ROUTES } from "../../../app.js";
import { AppShell } from "../../shell/app-shell.js";
import { RequireAuth } from "../../shell/require-auth.js";
import { OAuthConsentPage, OAuthConsentPageView } from "./oauth-consent-page.js";

describe("OAuthConsentPageView", () => {
  it("lets the user approve a non-empty subset of requested scopes", () => {
    render(<OAuthConsentPageViewHarness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Create sandbox sessions" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByTestId("approved-scopes").textContent).toBe("sandboxProfile:read");
  });

  it("requires a fresh authorization request when another organization is selected", () => {
    render(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={raiseUnexpectedAction}
        onContinueWithSelectedOrganization={raiseUnexpectedAction}
        onDeny={raiseUnexpectedAction}
        onSelectedOrganizationChange={raiseUnexpectedOrganizationChange}
        onSelectedScopesChange={raiseUnexpectedScopesChange}
        organizationName="Acme"
        organizationChanged
        organizationErrorMessage={null}
        organizations={OAuthConsentTestOrganizations}
        requestedScopes={["sandboxProfile:read", "sandboxSession:create"]}
        selectedOrganizationId="org_support"
        selectedScopes={new Set(["sandboxProfile:read", "sandboxSession:create"])}
        submissionState="editing"
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getByText("Support Sandbox")).toBeTruthy();
    expect(screen.getByText("Member")).toBeTruthy();
  });

  it("disables approval when every requested scope is deselected", () => {
    render(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={raiseUnexpectedAction}
        onContinueWithSelectedOrganization={raiseUnexpectedAction}
        onDeny={raiseUnexpectedAction}
        onSelectedOrganizationChange={raiseUnexpectedOrganizationChange}
        onSelectedScopesChange={raiseUnexpectedScopesChange}
        organizationName="Acme"
        organizationChanged={false}
        organizationErrorMessage={null}
        organizations={OAuthConsentTestOrganizations}
        requestedScopes={["sandboxProfile:read"]}
        selectedOrganizationId="org_acme"
        selectedScopes={new Set()}
        submissionState="editing"
      />,
    );

    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", true);
  });

  it("shows the submitted action in the disabled button label", () => {
    render(
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting
        onApprove={raiseUnexpectedAction}
        onContinueWithSelectedOrganization={raiseUnexpectedAction}
        onDeny={raiseUnexpectedAction}
        onSelectedOrganizationChange={raiseUnexpectedOrganizationChange}
        onSelectedScopesChange={raiseUnexpectedScopesChange}
        organizationName="Acme"
        organizationChanged={false}
        organizationErrorMessage={null}
        organizations={OAuthConsentTestOrganizations}
        requestedScopes={["sandboxProfile:read"]}
        selectedOrganizationId="org_acme"
        selectedScopes={new Set(["sandboxProfile:read"])}
        submissionState="approving"
      />,
    );

    expect(screen.getByRole("button", { name: "Approving..." })).toHaveProperty("disabled", true);
  });
});

function OAuthConsentPageViewHarness(): React.JSX.Element {
  const [selectedScopes, setSelectedScopes] = useState(
    () => new Set(["sandboxProfile:read", "sandboxSession:create"]),
  );
  const [approvedScopes, setApprovedScopes] = useState("");

  return (
    <>
      <OAuthConsentPageView
        approveErrorMessage={null}
        clientName="MCP Inspector"
        denyErrorMessage={null}
        isSubmitting={false}
        onApprove={() => {
          setApprovedScopes([...selectedScopes].join(","));
        }}
        onContinueWithSelectedOrganization={raiseUnexpectedAction}
        onDeny={raiseUnexpectedAction}
        onSelectedOrganizationChange={raiseUnexpectedOrganizationChange}
        onSelectedScopesChange={setSelectedScopes}
        organizationName="Acme"
        organizationChanged={false}
        organizationErrorMessage={null}
        organizations={OAuthConsentTestOrganizations}
        requestedScopes={["sandboxProfile:read", "sandboxSession:create"]}
        selectedOrganizationId="org_acme"
        selectedScopes={selectedScopes}
        submissionState="editing"
      />
      <output data-testid="approved-scopes">{approvedScopes}</output>
    </>
  );
}

const OAuthConsentTestOrganizations = [
  {
    id: "org_acme",
    name: "Acme",
    role: "admin",
    isCurrent: true,
  },
  {
    id: "org_support",
    name: "Support Sandbox",
    role: "member",
    isCurrent: false,
  },
] as const;

function raiseUnexpectedAction(): void {
  throw new Error("Unexpected OAuth consent action.");
}

function raiseUnexpectedOrganizationChange(organizationId: string): void {
  throw new Error(`Unexpected organization change to ${organizationId}.`);
}

function raiseUnexpectedScopesChange(scopes: Set<string>): void {
  throw new Error(`Unexpected scope change to ${[...scopes].join(",")}.`);
}

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
