export type HomeOnboardingState =
  | "no_ai_connection"
  | "profile_not_launchable"
  | "ready_for_first_session"
  | "ready_for_first_automation"
  | "automation_requires_webhook_integration"
  | "activated";

export type HomeOnboardingBlockerId =
  | "missing_agent_connection"
  | "missing_profile"
  | "missing_agent_binding"
  | "invalid_profile_binding"
  | "inactive_bound_connection"
  | "no_launchable_profile"
  | "missing_webhook_capable_connection"
  | "missing_webhook_source"
  | "missing_automation";

export type HomeOnboardingBlocker = {
  id: HomeOnboardingBlockerId;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

export type HomeOnboardingStepId =
  | "connect_integration"
  | "create_profile"
  | "launch_session"
  | "create_automation";

export type HomeOnboardingStep = {
  id: HomeOnboardingStepId;
  title: string;
  description: string;
  status: "complete" | "current" | "upcoming" | "blocked";
  href: string;
  actionLabel: string;
};

export type HomeOnboardingCallToAction = {
  href: string;
  label: string;
};

export type HomeOnboardingViewModel = {
  state: HomeOnboardingState;
  headline: string;
  supportingText: string;
  primaryCta: HomeOnboardingCallToAction;
  secondaryCta?: HomeOnboardingCallToAction;
  blockers: readonly HomeOnboardingBlocker[];
  steps: readonly HomeOnboardingStep[];
};

export type HomeOnboardingSummary = {
  hasIntegrations: boolean;
  hasProfiles: boolean;
  hasUsableProfiles: boolean;
  hasStartedSession: boolean;
  hasWebhookCapableIntegration: boolean;
  hasAutomations: boolean;
};

function createBaseSteps(): HomeOnboardingStep[] {
  return [
    {
      id: "connect_integration",
      title: "Add integrations",
      description:
        "Integrations provide the models, tools, and external systems your agents can use, like OpenAI, GitHub, and Slack.",
      status: "upcoming",
      href: "/settings/organization/integrations",
      actionLabel: "Add integrations",
    },
    {
      id: "create_profile",
      title: "Set up a profile",
      description:
        "A profile defines the setup an agent starts with, including its tools, permissions, and environment.",
      status: "upcoming",
      href: "/sandbox-profiles/new",
      actionLabel: "Set up a profile",
    },
    {
      id: "launch_session",
      title: "Launch first session",
      description:
        "Start a session to work on a task, like reviewing a pull request or investigating a bug.",
      status: "upcoming",
      href: "/sessions/new",
      actionLabel: "Start session",
    },
    {
      id: "create_automation",
      title: "Create an automation",
      description:
        "Automations are ways to respond to events that happen in other tools, like GitHub, Slack, or Jira.",
      status: "upcoming",
      href: "/automations/new",
      actionLabel: "Create automation",
    },
  ];
}

function withStepStatuses(
  statuses: Readonly<Record<HomeOnboardingStepId, HomeOnboardingStep["status"]>>,
): readonly HomeOnboardingStep[] {
  return createBaseSteps().map((step) => ({
    ...step,
    status: statuses[step.id],
  }));
}

function replaceStep(
  steps: readonly HomeOnboardingStep[],
  stepId: HomeOnboardingStepId,
  overrides: Partial<HomeOnboardingStep>,
): readonly HomeOnboardingStep[] {
  return steps.map((step) => (step.id === stepId ? { ...step, ...overrides } : step));
}

export const HomePageStoryModels = {
  noAiConnection: {
    state: "no_ai_connection",
    headline: "Add integrations",
    supportingText:
      "Sandbox profiles need an active agent-capable connection before sessions can launch.",
    primaryCta: {
      href: "/settings/organization/integrations",
      label: "Add integrations",
    },
    secondaryCta: {
      href: "/sandbox-profiles",
      label: "View profiles",
    },
    blockers: [
      {
        id: "missing_agent_connection",
        title: "No active agent connection",
        description:
          "The workspace does not have an active integration connection available for agent bindings.",
        href: "/settings/organization/integrations",
        actionLabel: "Add integrations",
      },
    ],
    steps: withStepStatuses({
      connect_integration: "current",
      create_profile: "upcoming",
      launch_session: "upcoming",
      create_automation: "upcoming",
    }),
  } satisfies HomeOnboardingViewModel,
  missingProfile: {
    state: "profile_not_launchable",
    headline: "Set up a profile",
    supportingText:
      "You have an integration connection, but no sandbox profile exists yet for sessions or automations.",
    primaryCta: {
      href: "/sandbox-profiles",
      label: "Create profile",
    },
    secondaryCta: {
      href: "/settings/organization/integrations",
      label: "View integrations",
    },
    blockers: [
      {
        id: "missing_profile",
        title: "No sandbox profile created",
        description: "Create a profile before you can attach bindings and launch sessions.",
        href: "/sandbox-profiles",
        actionLabel: "Create profile",
      },
      {
        id: "no_launchable_profile",
        title: "No launchable profile",
        description: "The session picker stays empty until at least one profile is launchable.",
        href: "/sessions/new",
        actionLabel: "Review session launch",
      },
    ],
    steps: withStepStatuses({
      connect_integration: "complete",
      create_profile: "current",
      launch_session: "upcoming",
      create_automation: "upcoming",
    }),
  } satisfies HomeOnboardingViewModel,
  profileNeedsBinding: {
    state: "profile_not_launchable",
    headline: "Complete your profile",
    supportingText:
      "Your profile exists, but it still needs setup before agents can start with the right tools, permissions, and environment.",
    primaryCta: {
      href: "/sandbox-profiles",
      label: "Complete profile",
    },
    secondaryCta: {
      href: "/sessions/new",
      label: "View session launch",
    },
    blockers: [
      {
        id: "missing_agent_binding",
        title: "Profile has no agent binding",
        description:
          "Attach an active agent connection to the latest profile version so sessions can start.",
        href: "/sandbox-profiles",
        actionLabel: "Complete profile",
      },
      {
        id: "no_launchable_profile",
        title: "No launchable profile",
        description:
          "The current profile exists, but it does not meet session-launch requirements.",
        href: "/sandbox-profiles",
        actionLabel: "Complete profile",
      },
    ],
    steps: replaceStep(
      withStepStatuses({
        connect_integration: "complete",
        create_profile: "current",
        launch_session: "upcoming",
        create_automation: "upcoming",
      }),
      "create_profile",
      {
        title: "Complete your profile",
        description:
          "Finish setting up the profile so agents have the tools, permissions, and environment they need to start.",
        actionLabel: "Complete profile",
        href: "/sandbox-profiles",
      },
    ),
  } satisfies HomeOnboardingViewModel,
  readyForFirstSession: {
    state: "ready_for_first_session",
    headline: "Launch first session",
    supportingText:
      "Your workspace has a launchable profile. Launch a session now to verify the setup and reach first value.",
    primaryCta: {
      href: "/sessions/new",
      label: "Start first session",
    },
    secondaryCta: {
      href: "/sandbox-profiles",
      label: "View profiles",
    },
    blockers: [],
    steps: withStepStatuses({
      connect_integration: "complete",
      create_profile: "complete",
      launch_session: "current",
      create_automation: "upcoming",
    }),
  } satisfies HomeOnboardingViewModel,
  readyForFirstAutomation: {
    state: "ready_for_first_automation",
    headline: "Create an automation",
    supportingText:
      "Core setup is complete. The next meaningful step is turning a webhook-capable integration into an automation.",
    primaryCta: {
      href: "/automations/new",
      label: "Create first automation",
    },
    secondaryCta: {
      href: "/automations",
      label: "View automations",
    },
    blockers: [
      {
        id: "missing_automation",
        title: "No automation created yet",
        description:
          "You have the prerequisites for automation, but no workflow is configured yet.",
        href: "/automations/new",
        actionLabel: "Create automation",
      },
    ],
    steps: withStepStatuses({
      connect_integration: "complete",
      create_profile: "complete",
      launch_session: "complete",
      create_automation: "current",
    }),
  } satisfies HomeOnboardingViewModel,
  automationRequiresWebhookIntegration: {
    state: "automation_requires_webhook_integration",
    headline: "Add a webhook integration",
    supportingText:
      "Core setup is complete. Add a webhook-capable integration before you can create an automation.",
    primaryCta: {
      href: "/settings/organization/integrations",
      label: "Add integrations",
    },
    secondaryCta: {
      href: "/automations",
      label: "View automations",
    },
    blockers: [
      {
        id: "missing_webhook_capable_connection",
        title: "No webhook-capable integration",
        description:
          "Automations respond to events from tools like GitHub, Slack, or Jira, so you need a webhook-capable integration before you can create one.",
        href: "/settings/organization/integrations",
        actionLabel: "Add integrations",
      },
    ],
    steps: replaceStep(
      withStepStatuses({
        connect_integration: "complete",
        create_profile: "complete",
        launch_session: "complete",
        create_automation: "current",
      }),
      "create_automation",
      {
        title: "Add a webhook integration",
        description:
          "Automations respond to events from tools like GitHub, Slack, or Jira, so you need a webhook-capable integration before you can create one.",
        href: "/settings/organization/integrations",
        actionLabel: "Add integrations",
      },
    ),
  } satisfies HomeOnboardingViewModel,
  activated: {
    state: "activated",
    headline: "Workspace activated",
    supportingText:
      "Core onboarding is complete. Home can now transition toward operational triage and activity.",
    primaryCta: {
      href: "/sessions/new",
      label: "Start session",
    },
    secondaryCta: {
      href: "/automations",
      label: "View automations",
    },
    blockers: [],
    steps: withStepStatuses({
      connect_integration: "complete",
      create_profile: "complete",
      launch_session: "complete",
      create_automation: "complete",
    }),
  } satisfies HomeOnboardingViewModel,
} as const;

export function createHomeOnboardingViewModel(
  input: HomeOnboardingSummary,
): HomeOnboardingViewModel {
  if (!input.hasIntegrations) {
    return HomePageStoryModels.noAiConnection;
  }

  if (!input.hasProfiles) {
    return HomePageStoryModels.missingProfile;
  }

  if (!input.hasUsableProfiles) {
    return HomePageStoryModels.profileNeedsBinding;
  }

  if (!input.hasStartedSession) {
    return HomePageStoryModels.readyForFirstSession;
  }

  if (!input.hasWebhookCapableIntegration && !input.hasAutomations) {
    return HomePageStoryModels.automationRequiresWebhookIntegration;
  }

  if (!input.hasAutomations) {
    return HomePageStoryModels.readyForFirstAutomation;
  }

  return HomePageStoryModels.activated;
}
