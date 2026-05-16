export type HomeChecklistState =
  | "add_integrations"
  | "set_up_profile"
  | "complete_profile"
  | "launch_first_session"
  | "add_webhook_integration"
  | "create_trigger"
  | "completed";

export type HomeChecklistStepId =
  | "add_integrations"
  | "set_up_profile"
  | "launch_first_session"
  | "create_trigger";

export type HomeChecklistStep = {
  id: HomeChecklistStepId;
  title: string;
  description: string;
  status: "complete" | "current" | "upcoming";
  href: string;
  actionLabel: string;
};

export type HomeChecklistViewModel = {
  state: HomeChecklistState;
  steps: readonly HomeChecklistStep[];
};

export type HomeOnboardingSummary = {
  hasIntegrations: boolean;
  hasProfiles: boolean;
  hasUsableProfiles: boolean;
  hasStartedSession: boolean;
  hasWebhookCapableIntegration: boolean;
  hasTriggers: boolean;
};

function createBaseSteps(): HomeChecklistStep[] {
  return [
    {
      id: "add_integrations",
      title: "Add integrations",
      description:
        "Integrations provide the models, tools, and external systems your agents can use, like OpenAI, GitHub, and Slack.",
      status: "upcoming",
      href: "/integrations",
      actionLabel: "Add integrations",
    },
    {
      id: "set_up_profile",
      title: "Set up a profile",
      description:
        "A profile defines the setup an agent starts with, including its tools, permissions, and environment.",
      status: "upcoming",
      href: "/sandbox-profiles",
      actionLabel: "Set up a profile",
    },
    {
      id: "launch_first_session",
      title: "Launch first session",
      description:
        "Start a session to work on a task, like reviewing a pull request or investigating a bug.",
      status: "upcoming",
      href: "/sessions/new",
      actionLabel: "Start session",
    },
    {
      id: "create_trigger",
      title: "Create a trigger",
      description:
        "Triggers respond to events that happen in other tools, like GitHub, Slack, or Jira.",
      status: "upcoming",
      href: "/triggers/new",
      actionLabel: "Create trigger",
    },
  ];
}

function createChecklistModel(
  state: HomeChecklistState,
  statuses: Readonly<Record<HomeChecklistStepId, HomeChecklistStep["status"]>>,
  input?: {
    stepOverrides?: Partial<Record<HomeChecklistStepId, Partial<HomeChecklistStep>>>;
  },
): HomeChecklistViewModel {
  const overrides = input?.stepOverrides;

  return {
    state,
    steps: createBaseSteps().map((step) => ({
      ...step,
      status: statuses[step.id],
      ...(overrides?.[step.id] ?? {}),
    })),
  };
}

export const HomePageStoryModels = {
  addIntegrations: createChecklistModel("add_integrations", {
    add_integrations: "current",
    set_up_profile: "upcoming",
    launch_first_session: "upcoming",
    create_trigger: "upcoming",
  }),
  setUpProfile: createChecklistModel("set_up_profile", {
    add_integrations: "complete",
    set_up_profile: "current",
    launch_first_session: "upcoming",
    create_trigger: "upcoming",
  }),
  completeProfile: createChecklistModel(
    "complete_profile",
    {
      add_integrations: "complete",
      set_up_profile: "current",
      launch_first_session: "upcoming",
      create_trigger: "upcoming",
    },
    {
      stepOverrides: {
        set_up_profile: {
          title: "Complete your profile",
          description:
            "Finish setting up the profile so agents have the tools, permissions, and environment they need to start.",
          href: "/sandbox-profiles",
          actionLabel: "Complete profile",
        },
      },
    },
  ),
  launchFirstSession: createChecklistModel("launch_first_session", {
    add_integrations: "complete",
    set_up_profile: "complete",
    launch_first_session: "current",
    create_trigger: "upcoming",
  }),
  addWebhookIntegration: createChecklistModel(
    "add_webhook_integration",
    {
      add_integrations: "complete",
      set_up_profile: "complete",
      launch_first_session: "complete",
      create_trigger: "current",
    },
    {
      stepOverrides: {
        create_trigger: {
          title: "Add a webhook integration",
          description:
            "Triggers respond to events from tools like GitHub, Slack, or Jira, so you need a webhook-capable integration before you can create one.",
          href: "/integrations",
          actionLabel: "Add integrations",
        },
      },
    },
  ),
  createTrigger: createChecklistModel("create_trigger", {
    add_integrations: "complete",
    set_up_profile: "complete",
    launch_first_session: "complete",
    create_trigger: "current",
  }),
  completed: createChecklistModel("completed", {
    add_integrations: "complete",
    set_up_profile: "complete",
    launch_first_session: "complete",
    create_trigger: "complete",
  }),
} as const;

export function createHomeOnboardingViewModel(
  input: HomeOnboardingSummary,
): HomeChecklistViewModel {
  if (!input.hasIntegrations) {
    return HomePageStoryModels.addIntegrations;
  }

  if (!input.hasProfiles) {
    return HomePageStoryModels.setUpProfile;
  }

  if (!input.hasUsableProfiles) {
    return HomePageStoryModels.completeProfile;
  }

  if (!input.hasStartedSession) {
    return HomePageStoryModels.launchFirstSession;
  }

  if (!input.hasWebhookCapableIntegration && !input.hasTriggers) {
    return HomePageStoryModels.addWebhookIntegration;
  }

  if (!input.hasTriggers) {
    return HomePageStoryModels.createTrigger;
  }

  return HomePageStoryModels.completed;
}
