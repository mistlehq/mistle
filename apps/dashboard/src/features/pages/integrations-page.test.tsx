// @vitest-environment jsdom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { resetDashboardConfigForTest } from "../../config.js";
import { createTestQueryClient } from "../../test-support/query-client.js";
import type {
  IntegrationConnection,
  IntegrationTarget,
} from "../integrations/integrations-service.js";
import { SESSION_QUERY_KEY } from "../shell/session-query.js";
import { IntegrationsPage } from "./integrations-page.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

describe("IntegrationsPage", () => {
  afterEach(() => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = undefined;
    resetDashboardConfigForTest();
  });

  it("selects the route-requested connection after a stale directory response refreshes", async () => {
    globalThis.__MISTLE_RUNTIME_CONFIG__ = {
      controlPlaneApiOrigin: "https://control-plane.example.com",
    };
    resetDashboardConfigForTest();

    const queryClient = createTestQueryClient({
      refetchOnMount: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    queryClient.setQueryData(SESSION_QUERY_KEY, {
      session: {
        activeOrganizationId: "org_mistle",
      },
    });
    queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
      targets: [createGitHubTarget()],
      connections: [
        createGitHubConnection({
          id: "icn_first",
          displayName: "First GitHub",
          installationId: "111",
        }),
      ],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/integrations/github-cloud?connectionId=icn_newly_installed"]}
        >
          <Routes>
            <Route element={<IntegrationsPage />} path="/integrations/:targetKey" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      screen
        .getByRole("button", { name: "Select connection First GitHub" })
        .getAttribute("aria-current"),
    ).toBe("true");

    act(() => {
      queryClient.setQueryData(SETTINGS_INTEGRATIONS_QUERY_KEY, {
        targets: [createGitHubTarget()],
        connections: [
          createGitHubConnection({
            id: "icn_first",
            displayName: "First GitHub",
            installationId: "111",
          }),
          createGitHubConnection({
            id: "icn_newly_installed",
            displayName: "Newly Installed GitHub",
            installationId: "222",
          }),
        ],
      });
    });

    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Select connection Newly Installed GitHub" })
          .getAttribute("aria-current"),
      ).toBe("true");
    });
    expect(
      screen
        .getByRole("button", { name: "Select connection First GitHub" })
        .hasAttribute("aria-current"),
    ).toBe(false);
  });
});

function createGitHubTarget(): IntegrationTarget {
  return {
    targetKey: "github-cloud",
    familyId: "github",
    variantId: "github-cloud",
    enabled: true,
    config: {},
    displayName: "GitHub",
    description: "GitHub Cloud",
    targetHealth: {
      configStatus: "valid",
    },
    connectionMethods: [
      {
        id: "github-app-installation",
        label: "GitHub App installation",
        kind: "form",
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key",
            inputType: "textarea",
          },
        ],
      },
    ],
  };
}

function createGitHubConnection(input: {
  id: string;
  displayName: string;
  installationId: string;
}): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "github-cloud",
    displayName: input.displayName,
    status: "active",
    bindingCount: 0,
    connectionMethodId: "github-app-installation",
    connectionMethodLabel: "GitHub App installation",
    externalSubjectId: input.installationId,
    config: {
      connection_method: "github-app-installation",
      app_id: "3079908",
      app_slug: "jon-mistle-github",
      client_id: "Iv1.client",
      installation_id: input.installationId,
    },
    resources: [],
    createdAt: "2026-04-24T00:00:00.000Z",
    updatedAt: "2026-04-24T00:00:00.000Z",
  };
}
