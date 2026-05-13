import type {
  ProfileSettingsLinkedAccountsSectionProps,
  ProfileSettingsPageViewProps,
  ProfileSettingsUserSectionProps,
} from "./profile-settings-page-view.js";

type LinkedAccountCard = NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

function createGitHubCard(overrides: Partial<LinkedAccountCard> = {}): LinkedAccountCard {
  return {
    providerFamily: "github",
    displayName: "GitHub",
    logoKey: "github",
    statusLabel: "Linked",
    statusTone: "active",
    accountLabel: "@mistle-user",
    helperMessage: null,
    emailPreference: null,
    commitSigning: null,
    primaryActionLabel: null,
    secondaryActionLabel: "Unlink",
    ...overrides,
  };
}

function createSlackCard(overrides: Partial<LinkedAccountCard> = {}): LinkedAccountCard {
  return {
    providerFamily: "slack",
    displayName: "Slack",
    logoKey: "slack",
    statusLabel: "Linked",
    statusTone: "active",
    accountLabel: "Mistle Workspace",
    helperMessage: null,
    emailPreference: null,
    commitSigning: null,
    primaryActionLabel: null,
    secondaryActionLabel: "Unlink",
    ...overrides,
  };
}

const GitHubEmailOptions = [
  {
    value: "mistle-user@example.com",
    label: "mistle-user@example.com (Primary)",
  },
  {
    value: "engineering@example.com",
    label: "engineering@example.com",
  },
] satisfies NonNullable<NonNullable<LinkedAccountCard["emailPreference"]>["options"]>;

export const GitHubLinkedWithConfiguredSigningCard = createGitHubCard({
  emailPreference: {
    selectedEmail: "mistle-user@example.com",
    options: GitHubEmailOptions,
  },
  commitSigning: {
    statusLabel: "Private key added",
    keySummaryLabel: "SHA256:abc123",
    uploadActionLabel: "Replace private key",
    removeActionLabel: "Remove key",
  },
});

export const GitHubNotLinkedCard = createGitHubCard({
  statusLabel: "Not linked",
  statusTone: "warning",
  accountLabel: "No linked account yet",
  primaryActionLabel: "Link account",
  secondaryActionLabel: null,
});

export const GitHubRelinkRequiredCard = createGitHubCard({
  statusLabel: "Relink required",
  statusTone: "warning",
  primaryActionLabel: "Relink",
  secondaryActionLabel: "Unlink",
});

export const GitHubLinkedWithSigningNotConfiguredCard = createGitHubCard({
  emailPreference: {
    selectedEmail: "mistle-user@example.com",
    options: GitHubEmailOptions,
  },
  commitSigning: {
    statusLabel: "Add private key",
    keySummaryLabel: null,
    uploadActionLabel: "Upload private key",
    removeActionLabel: null,
  },
});

export const GitHubDisabledButStillLinkedCard = createGitHubCard({
  statusLabel: "Disabled",
  statusTone: "disabled",
  helperMessage:
    "Your organization has disabled GitHub identity linking. You can still unlink this account.",
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
});

export const SlackNotLinkedCard = createSlackCard({
  statusLabel: "Not linked",
  statusTone: "warning",
  accountLabel: "No linked account yet",
  primaryActionLabel: "Link account",
  secondaryActionLabel: null,
});

export const SlackLinkedCard = createSlackCard();

export const SlackRelinkRequiredCard = createSlackCard({
  statusLabel: "Relink required",
  statusTone: "warning",
  primaryActionLabel: "Relink",
  secondaryActionLabel: "Unlink",
});

export const SlackDisabledButStillLinkedCard = createSlackCard({
  statusLabel: "Disabled",
  statusTone: "disabled",
  helperMessage:
    "Your organization has disabled Slack identity linking. You can still unlink this account.",
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
});

export const DefaultProfileSettingsPageViewProps: ProfileSettingsPageViewProps = {
  displayName: "Mistle Developer",
  email: "developer@mistle.so",
  imageUrl: null,
  pendingLinkedAccountProviderFamilies: [],
  linkedAccountCallbackNotice: null,
  linkedAccountCards: [],
  linkedAccountErrorMessage: null,
  linkedAccountsEmptyStateMessage: null,
  linkedAccountsLoading: false,
  linkedAccountsLoadErrorMessage: null,
  onCheckLinkedAccountCommitSigningKey: async () => ({
    status: "registered",
    publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMistle",
    publicKeyFingerprint: "SHA256:mistle",
  }),
  onDeleteLinkedAccountCommitSigningKey: async () => {},
  onDeleteProfileImage: async () => {},
  onLinkLinkedAccount: async () => {},
  onSaveChanges: async () => {},
  onUnlinkLinkedAccount: async () => {},
  onUpdateLinkedAccountPreferredEmail: async () => {},
  onUploadLinkedAccountCommitSigningKey: async () => {},
  onUploadProfileImage: async () => {},
  profileImageBusy: false,
  profileImageErrorMessage: null,
  saving: false,
};

export const DefaultProfileSettingsUserSectionProps: ProfileSettingsUserSectionProps =
  DefaultProfileSettingsPageViewProps;

export const DefaultProfileSettingsLinkedAccountsSectionProps: ProfileSettingsLinkedAccountsSectionProps =
  DefaultProfileSettingsPageViewProps;
