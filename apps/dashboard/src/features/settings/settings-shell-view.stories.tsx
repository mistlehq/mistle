import type { Meta, StoryObj } from "@storybook/react-vite";

import { createDashboardMemoryRouterDecorator } from "../../storybook/decorators.js";
import {
  createOrganizationGeneralSettingsFixtureContent,
  createOrganizationMembersSettingsFixtureContent,
  createProfileSettingsFixtureContent,
  createSettingsFixtureInviteMembersButton,
} from "./settings-fixtures.js";
import { SettingsShellView } from "./settings-shell-view.js";

type SettingsShellStoryArgs = React.ComponentProps<typeof SettingsShellView> & {
  examplePage: "organization-general" | "organization-members" | "profile";
};

function createStoryBreadcrumb(text: string): React.JSX.Element {
  return <p className="truncate text-sm">{text}</p>;
}

function createProfileStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Profile"),
    content: createProfileSettingsFixtureContent(),
    headerActions: null,
    layoutVariant: "form",
    onBack: () => {},
    pathname: "/settings/account/profile",
    showBreadcrumbs: true,
    supportingText: "",
    title: "Profile",
  };
}

function createOrganizationGeneralStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Organization / General"),
    content: createOrganizationGeneralSettingsFixtureContent(),
    headerActions: null,
    layoutVariant: "form",
    onBack: () => {},
    pathname: "/settings/organization/general",
    showBreadcrumbs: true,
    supportingText: "",
    title: "General",
  };
}

function createOrganizationMembersStoryArgs(): React.ComponentProps<typeof SettingsShellView> {
  return {
    backLabel: "Back",
    breadcrumbs: createStoryBreadcrumb("Settings / Organization / Members"),
    content: createOrganizationMembersSettingsFixtureContent(),
    headerActions: createSettingsFixtureInviteMembersButton(),
    layoutVariant: "default",
    onBack: () => {},
    pathname: "/settings/organization/members",
    showBreadcrumbs: true,
    supportingText: "",
    title: "Members",
  };
}

function resolveExamplePageArgs(
  examplePage: SettingsShellStoryArgs["examplePage"],
): React.ComponentProps<typeof SettingsShellView> {
  if (examplePage === "organization-general") {
    return createOrganizationGeneralStoryArgs();
  }

  if (examplePage === "organization-members") {
    return createOrganizationMembersStoryArgs();
  }

  return createProfileStoryArgs();
}

const meta = {
  title: "Dashboard/Settings/SettingsShellView",
  component: SettingsShellView,
  decorators: [createDashboardMemoryRouterDecorator()],
  parameters: {
    layout: "fullscreen",
    controls: {
      include: [
        "examplePage",
        "layoutVariant",
        "showBreadcrumbs",
        "title",
        "supportingText",
        "pathname",
        "backLabel",
      ],
    },
  },
  argTypes: {
    backLabel: {
      control: "text",
    },
    breadcrumbs: {
      control: false,
    },
    content: {
      control: false,
    },
    examplePage: {
      control: "inline-radio",
      options: ["profile", "organization-general", "organization-members"],
    },
    headerActions: {
      control: false,
    },
    layoutVariant: {
      control: "inline-radio",
      options: ["default", "form"],
    },
    onBack: {
      control: false,
    },
    pathname: {
      control: "text",
    },
    showBreadcrumbs: {
      control: "boolean",
    },
    supportingText: {
      control: "text",
    },
    title: {
      control: "text",
    },
  },
  args: {
    ...createProfileStoryArgs(),
    examplePage: "profile",
  },
  render: function RenderStory(input): React.JSX.Element {
    const baseArgs = resolveExamplePageArgs(input.examplePage);

    return (
      <SettingsShellView
        {...baseArgs}
        onBack={input.onBack}
        pathname={input.pathname}
        showBreadcrumbs={input.showBreadcrumbs}
        supportingText={input.supportingText}
        title={input.title}
        {...(input.backLabel === undefined ? {} : { backLabel: input.backLabel })}
        {...(input.layoutVariant === undefined ? {} : { layoutVariant: input.layoutVariant })}
      />
    );
  },
} satisfies Meta<SettingsShellStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
