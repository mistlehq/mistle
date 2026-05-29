export type WelcomeEmailContentInput = {
  callUrl?: string | undefined;
};

export type WelcomeEmailContent = {
  subject: string;
  templateName: string;
  greeting: string;
  intro: string;
  helpHeading: string;
  helpItems: readonly WelcomeEmailHelpItem[];
  useCaseRequest: string;
  signoff: {
    valediction: string;
    name: string;
  };
};

export type WelcomeEmailHelpItem =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "call";
      text: string;
      callUrl: string;
    };

export const WelcomeEmailSubject = "Welcome to Mistle";
export const WelcomeEmailTemplateName = "Welcome";

export function buildWelcomeEmailContent(input: WelcomeEmailContentInput): WelcomeEmailContent {
  const callUrl = input.callUrl?.trim();
  const helpItems: WelcomeEmailHelpItem[] = [
    {
      kind: "text",
      text: "Have feedback or questions? Reply to this email.",
    },
    {
      kind: "text",
      text: "Support via Slack Connect. Reply to this email and I'd set it up.",
    },
  ];

  if (callUrl !== undefined && callUrl.length > 0) {
    helpItems.push({
      kind: "call",
      text: "Setup guidance/Use case exploration. Book a call:",
      callUrl,
    });
  }

  return {
    subject: WelcomeEmailSubject,
    templateName: WelcomeEmailTemplateName,
    greeting: "Hey there,",
    intro: "I'm Jonathan, one of the co-founders.",
    helpHeading: "Ways I can help:",
    helpItems,
    useCaseRequest:
      "Also, I'd really appreciate it if you can share what use cases you're exploring Mistle for. Just reply to this email with a line or two.",
    signoff: {
      valediction: "Cheers,",
      name: "Jonathan",
    },
  };
}
