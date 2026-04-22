import type {
  ProfileSettingsLinkedAccountsSectionProps,
  ProfileSettingsPageViewProps,
  ProfileSettingsUserSectionProps,
} from "./profile-settings-page-view.js";

export const GitHubLinkedWithConfiguredSigningCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Linked",
  statusTone: "active",
  accountLabel: "@mistle-user",
  linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
  helperMessage: null,
  emailPreference: {
    selectedEmail: "mistle-user@example.com",
    options: [
      {
        value: "mistle-user@example.com",
        label: "mistle-user@example.com (Primary)",
      },
      {
        value: "engineering@example.com",
        label: "engineering@example.com",
      },
    ],
    helperText: "Used for sandbox Git identity and commit signing.",
  },
  commitSigning: {
    statusLabel: "Private key added",
    keySummaryLabel: "SHA256:abc123",
    helperLabel: null,
    helperCommand: null,
    uploadActionLabel: "Replace private key",
    removeActionLabel: "Remove key",
  },
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const GitHubNotLinkedCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Not linked",
  statusTone: "warning",
  accountLabel: "No linked account yet",
  linkedAtLabel: null,
  helperMessage: null,
  emailPreference: null,
  commitSigning: null,
  primaryActionLabel: "Link account",
  secondaryActionLabel: null,
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const GitHubRelinkRequiredCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Relink required",
  statusTone: "warning",
  accountLabel: "@mistle-user",
  linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
  helperMessage: null,
  emailPreference: null,
  commitSigning: null,
  primaryActionLabel: "Relink",
  secondaryActionLabel: "Unlink",
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const GitHubLinkedWithoutSelectableEmailsCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Linked",
  statusTone: "active",
  accountLabel: "@mistle-user",
  linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
  helperMessage: null,
  emailPreference: {
    selectedEmail: "",
    options: [],
    helperText: "",
  },
  commitSigning: {
    statusLabel: "Add private key",
    keySummaryLabel: null,
    helperLabel: null,
    helperCommand: null,
    uploadActionLabel: "Upload private key",
    removeActionLabel: null,
  },
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const GitHubLinkedWithSigningNotConfiguredCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Linked",
  statusTone: "active",
  accountLabel: "@mistle-user",
  linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
  helperMessage: null,
  emailPreference: {
    selectedEmail: "mistle-user@example.com",
    options: [
      {
        value: "mistle-user@example.com",
        label: "mistle-user@example.com (Primary)",
      },
      {
        value: "engineering@example.com",
        label: "engineering@example.com",
      },
    ],
    helperText: "Used for sandbox Git identity and commit signing.",
  },
  commitSigning: {
    statusLabel: "Add private key",
    keySummaryLabel: null,
    helperLabel: null,
    helperCommand: null,
    uploadActionLabel: "Upload private key",
    removeActionLabel: null,
  },
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const GitHubDisabledButStillLinkedCard = {
  providerFamily: "github",
  displayName: "GitHub",
  logoKey: "github",
  statusLabel: "Disabled",
  statusTone: "disabled",
  accountLabel: "@mistle-user",
  linkedAtLabel: "Linked Apr 19, 2026, 6:15 PM",
  helperMessage:
    "Your organization has disabled GitHub identity linking. You can still unlink this account.",
  emailPreference: null,
  commitSigning: null,
  primaryActionLabel: null,
  secondaryActionLabel: "Unlink",
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const SlackNotLinkedCard = {
  providerFamily: "slack",
  displayName: "Slack",
  logoKey: "slack",
  statusLabel: "Not linked",
  statusTone: "warning",
  accountLabel: "No linked account yet",
  linkedAtLabel: null,
  helperMessage: null,
  emailPreference: null,
  commitSigning: null,
  primaryActionLabel: "Link account",
  secondaryActionLabel: null,
} satisfies NonNullable<ProfileSettingsPageViewProps["linkedAccountCards"]>[number];

export const DefaultProfileSettingsPageViewProps: ProfileSettingsPageViewProps = {
  displayName: "Mistle Developer",
  email: "developer@mistle.so",
  imageUrl: null,
  linkedAccountActionPending: false,
  linkedAccountCallbackNotice: null,
  linkedAccountCards: [],
  linkedAccountErrorMessage: null,
  linkedAccountsEmptyStateMessage: null,
  linkedAccountsLoading: false,
  linkedAccountsLoadErrorMessage: null,
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
