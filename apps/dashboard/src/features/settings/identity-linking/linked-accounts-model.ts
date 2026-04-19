import { formatDateTime } from "../../shared/date-formatters.js";
import type { LinkedAccount } from "./linked-accounts-service.js";

export type LinkedAccountStatusTone = "active" | "warning" | "disabled";

export type LinkedAccountCallbackNotice = {
  title: string;
  message: string;
  variant: "default" | "alert";
};

export type LinkedAccountCardViewModel = {
  providerFamily: string;
  displayName: string;
  logoKey: string;
  statusLabel: string;
  statusTone: LinkedAccountStatusTone;
  accountLabel: string;
  linkedAtLabel: string | null;
  helperMessage: string | null;
  primaryActionLabel: string | null;
  secondaryActionLabel: string | null;
};

function resolveProviderDisplayName(providerFamily: string | null): string | null {
  switch (providerFamily) {
    case "github":
      return "GitHub";
    case "slack":
      return "Slack";
    default:
      return null;
  }
}

const LinkedAccountCallbackSearchParamKeys = [
  "linkedAccountProvider",
  "linkedAccountResult",
  "linkedAccountCode",
] as const;

export function findLinkedAccount(input: {
  linkedAccounts: readonly LinkedAccount[];
  providerFamily: string;
}): LinkedAccount | null {
  return (
    input.linkedAccounts.find(
      (linkedAccount) => linkedAccount.providerFamily === input.providerFamily,
    ) ?? null
  );
}

export function resolveLinkedAccountCardViewModel(
  linkedAccount: LinkedAccount,
): LinkedAccountCardViewModel {
  const providerDisplayName = linkedAccount.displayName;
  const requiresRelink =
    linkedAccount.principal?.status === "reauthorization_required" ||
    linkedAccount.credential?.status === "expired" ||
    linkedAccount.credential?.status === "reauthorization_required";

  if (linkedAccount.configurationStatus === "disabled") {
    return {
      providerFamily: linkedAccount.providerFamily,
      displayName: linkedAccount.displayName,
      logoKey: linkedAccount.logoKey,
      statusLabel: "Disabled",
      statusTone: "disabled",
      accountLabel: resolveLinkedAccountLabel(linkedAccount),
      linkedAtLabel:
        linkedAccount.principal === null
          ? null
          : `Linked ${formatDateTime(linkedAccount.principal.linkedAt)}`,
      helperMessage:
        linkedAccount.principal === null
          ? `Your organization has disabled ${providerDisplayName} identity linking.`
          : `Your organization has disabled ${providerDisplayName} identity linking. You can still unlink this account.`,
      primaryActionLabel: null,
      secondaryActionLabel: linkedAccount.principal === null ? null : "Unlink",
    };
  }

  if (linkedAccount.principal === null) {
    return {
      providerFamily: linkedAccount.providerFamily,
      displayName: linkedAccount.displayName,
      logoKey: linkedAccount.logoKey,
      statusLabel: "Not linked",
      statusTone: "warning",
      accountLabel: "No linked account yet",
      linkedAtLabel: null,
      helperMessage: null,
      primaryActionLabel: "Link account",
      secondaryActionLabel: null,
    };
  }

  if (requiresRelink) {
    return {
      providerFamily: linkedAccount.providerFamily,
      displayName: linkedAccount.displayName,
      logoKey: linkedAccount.logoKey,
      statusLabel: "Relink required",
      statusTone: "warning",
      accountLabel: resolveLinkedAccountLabel(linkedAccount),
      linkedAtLabel: `Linked ${formatDateTime(linkedAccount.principal.linkedAt)}`,
      helperMessage: `${providerDisplayName} needs to be linked again before Mistle can act as you.`,
      primaryActionLabel: "Relink",
      secondaryActionLabel: "Unlink",
    };
  }

  return {
    providerFamily: linkedAccount.providerFamily,
    displayName: linkedAccount.displayName,
    logoKey: linkedAccount.logoKey,
    statusLabel: "Linked",
    statusTone: "active",
    accountLabel: resolveLinkedAccountLabel(linkedAccount),
    linkedAtLabel: `Linked ${formatDateTime(linkedAccount.principal.linkedAt)}`,
    helperMessage: null,
    primaryActionLabel: "Relink",
    secondaryActionLabel: "Unlink",
  };
}

export function resolveLinkedAccountCardViewModels(
  linkedAccounts: readonly LinkedAccount[],
): LinkedAccountCardViewModel[] {
  return linkedAccounts
    .filter(
      (linkedAccount) =>
        linkedAccount.configurationStatus !== "disabled" || linkedAccount.principal !== null,
    )
    .map((linkedAccount) => resolveLinkedAccountCardViewModel(linkedAccount));
}

function resolveLinkedAccountLabel(linkedAccount: LinkedAccount): string {
  const profile = linkedAccount.principal?.profile;
  const login = profile?.["login"];
  if (typeof login === "string" && login.length > 0) {
    return `@${login}`;
  }

  const displayName = profile?.["displayName"];
  if (typeof displayName === "string" && displayName.length > 0) {
    return displayName;
  }

  const workspaceName = profile?.["workspaceName"];
  if (typeof workspaceName === "string" && workspaceName.length > 0) {
    return workspaceName;
  }

  const email = profile?.["email"];
  if (typeof email === "string" && email.length > 0) {
    return email;
  }

  const providerSubjectId = linkedAccount.principal?.providerSubjectId;
  if (
    providerSubjectId !== null &&
    providerSubjectId !== undefined &&
    providerSubjectId.length > 0
  ) {
    return `Account ${providerSubjectId}`;
  }

  return "Linked";
}

export function resolveLinkedAccountCallbackNotice(input: {
  providerFamily: string | null;
  result: string | null;
  code: string | null;
}): LinkedAccountCallbackNotice | null {
  const providerDisplayName = resolveProviderDisplayName(input.providerFamily);
  if (providerDisplayName === null) {
    return null;
  }

  if (input.result === "success") {
    return {
      title: `${providerDisplayName} linked`,
      message: `Your ${providerDisplayName} account is now linked to Mistle.`,
      variant: "default",
    };
  }

  if (input.result !== "failure") {
    return null;
  }

  return {
    title: `${providerDisplayName} link failed`,
    message: resolveLinkedAccountCallbackFailureMessage({
      providerDisplayName,
      code: input.code,
    }),
    variant: "alert",
  };
}

export function clearLinkedAccountCallbackSearchParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  for (const key of LinkedAccountCallbackSearchParamKeys) {
    nextSearchParams.delete(key);
  }

  return nextSearchParams;
}

function resolveLinkedAccountCallbackFailureMessage(input: {
  providerDisplayName: string;
  code: string | null;
}): string {
  switch (input.code) {
    case "REDIRECT_STATE_EXPIRED":
      return `This ${input.providerDisplayName} linking attempt expired. Start the link again.`;
    case "REDIRECT_STATE_ALREADY_USED":
      return `This ${input.providerDisplayName} linking attempt has already been used. Start the link again.`;
    case "PROVIDER_SUBJECT_ALREADY_LINKED":
      return `That ${input.providerDisplayName} account is already linked to another Mistle user in this organization.`;
    case "REDIRECT_STATE_INVALID":
    case "INVALID_LINKED_ACCOUNT_CALLBACK_INPUT":
      return `${input.providerDisplayName} linking could not be completed. Start the link again.`;
    default:
      return `${input.providerDisplayName} linking could not be completed. Please try again.`;
  }
}
