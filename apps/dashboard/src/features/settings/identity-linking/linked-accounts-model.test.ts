import { describe, expect, it } from "vitest";

import { formatDateTime } from "../../shared/date-formatters.js";
import {
  clearLinkedAccountCallbackSearchParams,
  findLinkedAccount,
  resolveLinkedAccountCallbackNotice,
  resolveLinkedAccountCardViewModel,
  resolveLinkedAccountCardViewModels,
} from "./linked-accounts-model.js";
import type { LinkedAccount } from "./linked-accounts-service.js";

function createGitHubLinkedAccount(overrides?: Partial<LinkedAccount>): LinkedAccount {
  return {
    providerFamily: "github",
    displayName: "GitHub",
    logoKey: "github",
    configurationStatus: "active",
    principal: {
      id: "uep_github",
      status: "active",
      providerSubjectId: "12345",
      profile: {
        login: "mistle-user",
      },
      linkedAt: "2026-04-19T10:15:00.000Z",
      updatedAt: "2026-04-19T10:15:00.000Z",
    },
    credential: {
      id: "upc_github",
      credentialKind: "github_app_user_access_token",
      status: "active",
      accessTokenExpiresAt: "2026-04-19T12:15:00.000Z",
      refreshTokenExpiresAt: "2026-10-19T12:15:00.000Z",
      lastValidatedAt: "2026-04-19T10:15:00.000Z",
      updatedAt: "2026-04-19T10:15:00.000Z",
    },
    ...overrides,
  };
}

function createSlackLinkedAccount(overrides?: Partial<LinkedAccount>): LinkedAccount {
  return {
    providerFamily: "slack",
    displayName: "Slack",
    logoKey: "slack",
    configurationStatus: "active",
    principal: {
      id: "uep_slack",
      status: "active",
      providerSubjectId: "T12345:U12345",
      profile: {
        workspaceName: "Mistle Engineering",
        displayName: "Mistle Slack User",
      },
      linkedAt: "2026-04-19T10:15:00.000Z",
      updatedAt: "2026-04-19T10:15:00.000Z",
    },
    credential: {
      id: "upc_slack",
      credentialKind: "slack_user_token",
      status: "active",
      accessTokenExpiresAt: "2026-04-19T12:15:00.000Z",
      refreshTokenExpiresAt: null,
      lastValidatedAt: "2026-04-19T10:15:00.000Z",
      updatedAt: "2026-04-19T10:15:00.000Z",
    },
    ...overrides,
  };
}

describe("linked-accounts-model", () => {
  it("finds the linked account for a provider family", () => {
    const github = createGitHubLinkedAccount();
    const slack = createSlackLinkedAccount({
      configurationStatus: "disabled",
      principal: null,
      credential: null,
    });

    expect(
      findLinkedAccount({
        linkedAccounts: [slack, github],
        providerFamily: "github",
      }),
    ).toEqual(github);
    expect(
      findLinkedAccount({
        linkedAccounts: [slack, github],
        providerFamily: "linear",
      }),
    ).toBeNull();
  });

  it("builds a linked card view model from the GitHub login", () => {
    const linkedAccount = createGitHubLinkedAccount();

    expect(resolveLinkedAccountCardViewModel(linkedAccount)).toEqual({
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      statusLabel: "Linked",
      statusTone: "active",
      accountLabel: "@mistle-user",
      linkedAtLabel: `Linked ${formatDateTime("2026-04-19T10:15:00.000Z")}`,
      helperMessage: null,
      primaryActionLabel: "Relink",
      secondaryActionLabel: "Unlink",
    });
  });

  it("builds an unlinked card view model when no principal exists", () => {
    const linkedAccount = createGitHubLinkedAccount({
      principal: null,
      credential: null,
    });

    expect(resolveLinkedAccountCardViewModel(linkedAccount)).toEqual({
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      statusLabel: "Not linked",
      statusTone: "warning",
      accountLabel: "No linked account yet",
      linkedAtLabel: null,
      helperMessage: null,
      primaryActionLabel: "Link account",
      secondaryActionLabel: null,
    });
  });

  it("builds a relink-required card view model for expired credentials", () => {
    const linkedAccount = createGitHubLinkedAccount({
      credential: {
        id: "upc_github",
        credentialKind: "github_app_user_access_token",
        status: "expired",
        accessTokenExpiresAt: "2026-04-19T12:15:00.000Z",
        refreshTokenExpiresAt: "2026-10-19T12:15:00.000Z",
        lastValidatedAt: "2026-04-19T10:15:00.000Z",
        updatedAt: "2026-04-19T10:15:00.000Z",
      },
    });

    expect(resolveLinkedAccountCardViewModel(linkedAccount)).toMatchObject({
      statusLabel: "Relink required",
      statusTone: "warning",
      helperMessage: "GitHub needs to be linked again before Mistle can act as you.",
      primaryActionLabel: "Relink",
      secondaryActionLabel: "Unlink",
    });
  });

  it("builds a disabled card view model and keeps unlink available", () => {
    const linkedAccount = createGitHubLinkedAccount({
      configurationStatus: "disabled",
    });

    expect(resolveLinkedAccountCardViewModel(linkedAccount)).toEqual({
      providerFamily: "github",
      displayName: "GitHub",
      logoKey: "github",
      statusLabel: "Disabled",
      statusTone: "disabled",
      accountLabel: "@mistle-user",
      linkedAtLabel: `Linked ${formatDateTime("2026-04-19T10:15:00.000Z")}`,
      helperMessage:
        "Your organization has disabled GitHub identity linking. You can still unlink this account.",
      primaryActionLabel: null,
      secondaryActionLabel: "Unlink",
    });
  });

  it("keeps disabled linked accounts visible so they can be unlinked", () => {
    expect(
      resolveLinkedAccountCardViewModels([
        createGitHubLinkedAccount({
          configurationStatus: "disabled",
        }),
      ]),
    ).toHaveLength(1);
  });

  it("hides disabled providers that have no linked account", () => {
    expect(
      resolveLinkedAccountCardViewModels([
        createSlackLinkedAccount({
          configurationStatus: "disabled",
          principal: null,
          credential: null,
        }),
      ]),
    ).toEqual([]);
  });

  it("resolves a success callback notice", () => {
    expect(
      resolveLinkedAccountCallbackNotice({
        providerFamily: "github",
        result: "success",
        code: null,
      }),
    ).toEqual({
      title: "GitHub linked",
      message: "Your GitHub account is now linked to Mistle.",
      variant: "default",
    });
  });

  it("resolves a redirect-expired callback failure notice", () => {
    expect(
      resolveLinkedAccountCallbackNotice({
        providerFamily: "github",
        result: "failure",
        code: "REDIRECT_STATE_EXPIRED",
      }),
    ).toEqual({
      title: "GitHub link failed",
      message: "This GitHub linking attempt expired. Start the link again.",
      variant: "alert",
    });
  });

  it("ignores callback notices for other providers", () => {
    expect(
      resolveLinkedAccountCallbackNotice({
        providerFamily: "slack",
        result: "success",
        code: null,
      }),
    ).toEqual({
      title: "Slack linked",
      message: "Your Slack account is now linked to Mistle.",
      variant: "default",
    });
  });

  it("uses workspace name as a fallback linked-account label", () => {
    expect(
      resolveLinkedAccountCardViewModel(
        createSlackLinkedAccount({
          principal: {
            id: "uep_slack",
            status: "active",
            providerSubjectId: "T12345:U12345",
            profile: {
              workspaceName: "Mistle Engineering",
            },
            linkedAt: "2026-04-19T10:15:00.000Z",
            updatedAt: "2026-04-19T10:15:00.000Z",
          },
        }),
      ),
    ).toMatchObject({
      accountLabel: "Mistle Engineering",
    });
  });

  it("clears linked-account callback params while preserving unrelated search params", () => {
    const searchParams = new URLSearchParams({
      linkedAccountProvider: "github",
      linkedAccountResult: "success",
      linkedAccountCode: "REDIRECT_STATE_EXPIRED",
      view: "security",
    });

    expect(clearLinkedAccountCallbackSearchParams(searchParams).toString()).toBe("view=security");
  });
});
