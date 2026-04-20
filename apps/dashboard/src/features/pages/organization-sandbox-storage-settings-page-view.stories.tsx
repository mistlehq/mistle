import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type { OrganizationSandboxStorageFormState } from "../settings/organization/sandbox-storage-model.js";
import { OrganizationSandboxStorageSettingsPageView } from "./organization-sandbox-storage-settings-page-view.js";

const ManagedState: OrganizationSandboxStorageFormState = {
  persistentSandboxesEnabled: false,
  storageConfigSource: "managed",
  region: "",
  namePrefix: "",
  apiKey: "",
  apiKeyConfigured: false,
  bucket: "",
  endpoint: "",
  accessKeyId: "",
  secretAccessKey: "",
  secretAccessKeyConfigured: false,
};

const OrganizationOverrideState: OrganizationSandboxStorageFormState = {
  persistentSandboxesEnabled: true,
  storageConfigSource: "organization",
  region: "aws-us-east-1",
  namePrefix: "mistle",
  apiKey: "archil-api-key",
  apiKeyConfigured: false,
  bucket: "mistle-sandboxes",
  endpoint: "https://storage.archil.example.com",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "secret-access-key",
  secretAccessKeyConfigured: false,
};

const meta = {
  title: "Dashboard/Settings/OrganizationSandboxStorage/PageView",
  component: OrganizationSandboxStorageSettingsPageView,
  decorators: [withDashboardPageStory],
  args: {
    state: ManagedState,
    isSaving: false,
    hasUnsavedChanges: false,
    saveErrorMessage: null,
    loadErrorMessage: null,
    visibleErrors: {},
    onCancel: () => {},
    onSave: async () => {},
    onStateChange: () => {},
  },
} satisfies Meta<typeof OrganizationSandboxStorageSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const ManagedDefault: Story = {};

export const LoadError: Story = {
  args: {
    loadErrorMessage: "Could not load sandbox storage settings.",
  },
};

export const OrganizationOverrideEnabled: Story = {
  args: {
    state: OrganizationOverrideState,
    hasUnsavedChanges: true,
  },
};

export const ExistingSecretsConfigured: Story = {
  args: {
    state: {
      ...OrganizationOverrideState,
      apiKey: "",
      apiKeyConfigured: true,
      secretAccessKey: "",
      secretAccessKeyConfigured: true,
    },
  },
};

export const ValidationErrors: Story = {
  args: {
    state: {
      ...OrganizationOverrideState,
      region: "",
      apiKey: "",
      bucket: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
    },
    hasUnsavedChanges: true,
    visibleErrors: {
      region: "Region is required.",
      apiKey: "API key is required.",
      bucket: "Bucket is required.",
      endpoint: "Endpoint is required.",
      accessKeyId: "Access key ID is required.",
      secretAccessKey: "Secret access key is required.",
    },
  },
};

export const SaveError: Story = {
  args: {
    state: OrganizationOverrideState,
    hasUnsavedChanges: true,
    saveErrorMessage: "Could not save sandbox storage settings.",
  },
};

export const Saving: Story = {
  args: {
    state: OrganizationOverrideState,
    isSaving: true,
    hasUnsavedChanges: true,
  },
};
