import { describe, expect, it } from "vitest";

import {
  LinearConnectionMethodIds,
  LinearCredentialSlotKeys,
  LinearOAuth2CredentialSlotKeys,
} from "./auth.js";
import { LinearIdentityLinkingCapability } from "./identity-linking.server.js";

describe("Linear identity linking", () => {
  it("supports org-owned Linear OAuth app connections with a stored client secret", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_oauth_app",
          status: "active",
          config: {
            connection_method: LinearConnectionMethodIds.OAUTH_APP,
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set([
          LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
        ]),
      }),
    ).toBe(true);
  });

  it("rejects Linear OAuth app connections without a stored client secret", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_oauth_app",
          status: "active",
          config: {
            connection_method: LinearConnectionMethodIds.OAUTH_APP,
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set(),
      }),
    ).toBe(false);
  });

  it("does not treat user OAuth token connections as org-owned app provider configs", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_user_oauth",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set([LinearOAuth2CredentialSlotKeys.clientSecret]),
      }),
    ).toBe(false);
  });
});
