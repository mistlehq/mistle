// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { OrganizationIdentityLinkingSettingsPageView } from "./organization-identity-linking-settings-page-view.js";

describe("OrganizationIdentityLinkingSettingsPageView", () => {
  it("renders configured and unconfigured providers with current connection state", () => {
    render(
      <MemoryRouter>
        <OrganizationIdentityLinkingSettingsPageView
          loadErrorMessage={null}
          onProviderConnectionChange={() => {}}
          onSaveProvider={async () => {}}
          onStatusAction={async () => {}}
          providers={[
            {
              providerFamily: "github",
              displayName: "GitHub",
              logoKey: "github",
              configurationStatusLabel: "Enabled",
              configurationStatusTone: "active",
              eligibleConnections: [
                {
                  id: "icn_github",
                  label: "Engineering GitHub · GitHub App installation",
                },
              ],
              selectedConnectionId: "icn_github",
              configureActionLabel: "Save",
              statusActionLabel: "Disable",
              statusActionNextStatus: "disabled",
              addConnectionOptions: [
                {
                  href: "/integrations/github-cloud/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
                  label: "Connect new",
                },
              ],
              statusActionVisible: true,
              statusActionDisabled: false,
              saveActionDisabled: false,
              saveActionPending: false,
              statusActionPending: false,
            },
            {
              providerFamily: "slack",
              displayName: "Slack",
              logoKey: "slack",
              configurationStatusLabel: "Not enabled",
              configurationStatusTone: "unconfigured",
              eligibleConnections: [],
              selectedConnectionId: null,
              configureActionLabel: "Save",
              statusActionLabel: "Enable",
              statusActionNextStatus: "active",
              addConnectionOptions: [
                {
                  href: "/integrations/slack-default/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
                  label: "Connect new",
                },
              ],
              statusActionVisible: false,
              statusActionDisabled: false,
              saveActionDisabled: true,
              saveActionPending: false,
              statusActionPending: false,
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByText("Enabled")).toBeTruthy();
    const githubConnectionSelect = screen.getByRole("combobox", {
      name: "Select approved GitHub connection",
    });
    expect(githubConnectionSelect.textContent).toContain(
      "Engineering GitHub · GitHub App installation",
    );
    expect(githubConnectionSelect.textContent).not.toContain("icn_github");
    const connectNewLinks = screen.getAllByRole("link", { name: "Connect new" });
    expect(connectNewLinks[0]?.getAttribute("href")).toBe(
      "/integrations/github-cloud/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
    );

    expect(screen.getByText("Slack")).toBeTruthy();
    expect(screen.getByText("Not enabled")).toBeTruthy();
    expect(
      screen.getByText("No eligible active connections yet. Connect a new one first."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    expect(saveButtons).toHaveLength(2);
    expect(saveButtons[1]?.hasAttribute("disabled")).toBe(true);
  });

  it("runs save and disable flows through the provided handlers", async () => {
    const saved: Array<{ providerFamily: string; integrationConnectionId: string }> = [];
    const statusUpdates: Array<{ providerFamily: string; status: "active" | "disabled" }> = [];

    function Harness(): React.JSX.Element {
      const [providers, setProviders] = useState<
        React.ComponentProps<typeof OrganizationIdentityLinkingSettingsPageView>["providers"]
      >([
        {
          providerFamily: "github",
          displayName: "GitHub",
          logoKey: "github",
          configurationStatusLabel: "Enabled",
          configurationStatusTone: "active",
          eligibleConnections: [
            {
              id: "icn_github_primary",
              label: "Engineering GitHub · GitHub App installation",
            },
          ],
          selectedConnectionId: "icn_github_primary",
          configureActionLabel: "Save",
          statusActionLabel: "Disable",
          statusActionNextStatus: "disabled",
          addConnectionOptions: [
            {
              href: "/integrations/github-cloud/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
              label: "Connect new",
            },
          ],
          statusActionVisible: true,
          statusActionDisabled: false,
          saveActionDisabled: false,
          saveActionPending: false,
          statusActionPending: false,
        },
      ]);

      return (
        <MemoryRouter>
          <OrganizationIdentityLinkingSettingsPageView
            loadErrorMessage={null}
            onProviderConnectionChange={({ providerFamily, integrationConnectionId }) => {
              setProviders((currentProviders) =>
                currentProviders.map((provider) =>
                  provider.providerFamily !== providerFamily
                    ? provider
                    : {
                        ...provider,
                        selectedConnectionId: integrationConnectionId,
                        saveActionDisabled: false,
                      },
                ),
              );
            }}
            onSaveProvider={async (input) => {
              saved.push(input);
            }}
            onStatusAction={async (input) => {
              statusUpdates.push(input);
            }}
            providers={providers}
          />
        </MemoryRouter>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saved).toEqual([
        {
          providerFamily: "github",
          integrationConnectionId: "icn_github_primary",
        },
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(statusUpdates).toEqual([
        {
          providerFamily: "github",
          status: "disabled",
        },
      ]);
    });
  });

  it("renders explicit add-connection choices when multiple eligible targets exist", () => {
    render(
      <MemoryRouter>
        <OrganizationIdentityLinkingSettingsPageView
          loadErrorMessage={null}
          onProviderConnectionChange={() => {}}
          onSaveProvider={async () => {}}
          onStatusAction={async () => {}}
          providers={[
            {
              providerFamily: "github",
              displayName: "GitHub",
              logoKey: "github",
              configurationStatusLabel: "Not enabled",
              configurationStatusTone: "unconfigured",
              eligibleConnections: [],
              selectedConnectionId: null,
              configureActionLabel: "Save",
              statusActionLabel: "Enable",
              statusActionNextStatus: "active",
              addConnectionOptions: [
                {
                  href: "/integrations/github-cloud/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
                  label: "Connect new (github-cloud)",
                },
                {
                  href: "/integrations/github-enterprise-server/add?returnTo=%2Fsettings%2Forganization%2Fidentity-linking",
                  label: "Connect new (github-enterprise-server)",
                },
              ],
              statusActionVisible: false,
              statusActionDisabled: false,
              saveActionDisabled: true,
              saveActionPending: false,
              statusActionPending: false,
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Connect new (github-cloud)" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Connect new (github-enterprise-server)" }),
    ).toBeTruthy();
  });
});
