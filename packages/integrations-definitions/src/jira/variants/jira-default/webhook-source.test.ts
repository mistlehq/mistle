import { describe, expect, it } from "vitest";

import { JiraConnectionMethodIds } from "./auth.js";
import {
  buildJiraWebhookCallbackUrl,
  JiraWebhookSourceCapability,
  resolveJiraAdminWebhookIdFromSelf,
  resolveJiraAdminWebhookRegistrationOrThrow,
} from "./webhook-source.server.js";

describe("jira webhook source helpers", () => {
  it("builds a source-keyed control-plane callback URL", () => {
    expect(
      buildJiraWebhookCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        targetKey: "jira-default",
        endpointKey: "ep_jira_123",
      }),
    ).toBe("https://control-plane.mistle.test/p/integration/webhooks/jira-default/ep_jira_123");
  });

  it("extracts Jira registration credentials from personal-token connections", () => {
    expect(
      resolveJiraAdminWebhookRegistrationOrThrow({
        connectionConfig: {
          connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
          site_url: "https://mistle-test.atlassian.net/",
          email: "jira@example.com",
        },
        connectionSecrets: {
          apiKey: "jira-api-token",
        },
      }),
    ).toEqual({
      siteUrl: "https://mistle-test.atlassian.net",
      email: "jira@example.com",
      apiKey: "jira-api-token",
    });
  });

  it("rejects non-personal Jira connection methods for webhook registration", () => {
    expect(() =>
      resolveJiraAdminWebhookRegistrationOrThrow({
        connectionConfig: {
          connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
          cloud_id: "cloud-123",
        },
        connectionSecrets: {
          apiKey: "jira-api-token",
        },
      }),
    ).toThrow("only supports personal API token connections");
  });

  it("only supports webhook sources for personal Jira connections", () => {
    expect(
      JiraWebhookSourceCapability.supportsConnection?.({
        connection: {
          id: "icn_jira_personal",
          status: "active",
          config: {
            connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
            site_url: "https://mistle-test.atlassian.net",
            email: "jira@example.com",
          },
        },
      }),
    ).toBe(true);

    expect(
      JiraWebhookSourceCapability.supportsConnection?.({
        connection: {
          id: "icn_jira_service_account",
          status: "active",
          config: {
            connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
            cloud_id: "cloud-123",
          },
        },
      }),
    ).toBe(false);
  });

  it("extracts the remote webhook id from the Jira self URL", () => {
    expect(
      resolveJiraAdminWebhookIdFromSelf({
        self: "https://mistle-test.atlassian.net/rest/webhooks/1.0/webhook/72",
      }),
    ).toBe("72");
  });
});
