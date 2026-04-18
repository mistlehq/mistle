import { describe, expect, it } from "vitest";

import { formatDateTime } from "../../shared/date-formatters.js";
import {
  clearLinkedAccountCallbackSearchParams,
  findLinkedAccount,
  resolveLinkedAccountCallbackNotice,
  resolveLinkedAccountCardViewModel,
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

describe("linked-accounts-model", () => {
  it("finds the linked account for a provider family", () => {
    const github = createGitHubLinkedAccount();
    const slack: LinkedAccount = {
      providerFamily: "slack",
      displayName: "Slack",
      logoKey: "slack",
      configurationStatus: "disabled",
      principal: null,
      credential: null,
    };

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
    ).toBeNull();
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
