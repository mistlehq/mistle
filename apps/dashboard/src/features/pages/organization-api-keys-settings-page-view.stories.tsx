import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  createDashboardMemoryRouterDecorator,
  withDashboardPageStory,
} from "../../storybook/decorators.js";
import type { ApiKey } from "../settings/api-keys/api-keys-service.js";
import { OrganizationApiKeysSettingsPageView } from "./organization-api-keys-settings-page-view.js";

const StoryApiKeys = [
  {
    id: "apk_story_prod",
    name: "Production deploy key",
    secretPrefix: "mstl_apk_ED4p8qJIc8ptYvhuD8yyOQ",
    permissions: [
      "sandboxProfile:read",
      "sandboxSession:create",
      "sandboxSession:read",
      "sandboxSession:connect",
      "triggerWebhook:read",
    ],
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-05-19T11:58:00.000Z",
    updatedAt: "2026-05-19T11:58:00.000Z",
  },
  {
    id: "apk_story_ci",
    name: "CI runner",
    secretPrefix: "mstl_apk_A9fZg2qP8xQmN7rT6wLs",
    permissions: ["sandboxProfile:read", "sandboxSession:create"],
    expiresAt: null,
    lastUsedAt: "2026-05-19T10:30:00.000Z",
    createdAt: "2026-05-18T14:20:00.000Z",
    updatedAt: "2026-05-19T10:30:00.000Z",
  },
] satisfies readonly ApiKey[];

const meta = {
  title: "Dashboard/Settings/OrganizationApiKeys/PageView",
  component: OrganizationApiKeysSettingsPageView,
  decorators: [withDashboardPageStory, createDashboardMemoryRouterDecorator()],
  args: {
    apiKeys: StoryApiKeys,
    createdApiKeyNotice: null,
    isLoading: false,
    listErrorMessage: null,
    onDismissCreatedApiKeyNotice: () => {},
    onRevokeApiKey: () => {},
    revokeErrorMessage: null,
    revokingApiKeyId: null,
  },
} satisfies Meta<typeof OrganizationApiKeysSettingsPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CreatedToken: Story = {
  args: {
    createdApiKeyNotice: {
      name: "Production deploy key",
      token: "mstl_apk_ED4p8qJIc8ptYvhuD8yyOQ_D7_Xb2zSjidMMRkOucJRYGKm",
    },
  },
};

export const Empty: Story = {
  args: {
    apiKeys: [],
  },
};

export const Loading: Story = {
  args: {
    apiKeys: [],
    isLoading: true,
  },
};

export const LoadError: Story = {
  args: {
    apiKeys: [],
    listErrorMessage: "Could not load API keys.",
  },
};

export const RevokeError: Story = {
  args: {
    revokeErrorMessage: "Could not revoke API key.",
  },
};
