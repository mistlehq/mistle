export type CreatedAutomationNavigationTarget = {
  id: string;
  target: {
    sandboxProfileId: string;
  };
};

export type AutomationCreateSuccessPath = (automation: CreatedAutomationNavigationTarget) => string;
