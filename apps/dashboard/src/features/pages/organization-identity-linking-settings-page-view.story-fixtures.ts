import type { OrganizationIdentityLinkingProviderRow } from "./organization-identity-linking-settings-page-view.js";

const StoryMemberNames: readonly string[] = [
  "Avery Chen",
  "Blair Morgan",
  "Casey Tan",
  "Devon Park",
  "Elliot Singh",
  "Finley Brooks",
  "Gray Rivera",
  "Harper Lim",
  "Indigo Wong",
  "Jordan Lee",
  "Kai Patel",
  "Logan Taylor",
  "Mika Santos",
  "Noah Kim",
  "Olivia Reyes",
  "Parker Stone",
  "Quinn Ahmad",
  "Riley Nguyen",
  "Sam Carter",
  "Taylor Zhao",
  "Uma Das",
  "Val Chen",
  "Winter Ong",
  "Xander Low",
  "Yael Cohen",
  "Zara Malik",
  "Alex Tan",
  "Brook Lee",
  "Chris Wong",
  "Dana Lim",
  "Emery Ho",
  "Francis Goh",
  "Gale Yap",
  "Hayden Lau",
  "Ira Teo",
  "Jules Sim",
];

type StoryMemberLink = OrganizationIdentityLinkingProviderRow["memberLinks"][number];

export const IdentityLinkingStoryMemberLinkStatusCounts = {
  GITHUB_ENGINEERING: { linked: 12, total: 36 },
  SLACK_WORKSPACE: { linked: 3, total: 14 },
};

export function createIdentityLinkingMemberLinks(input: {
  count: {
    linked: number;
    total: number;
  };
  emailDomain: string;
  idPrefix: string;
}): StoryMemberLink[] {
  return Array.from({ length: input.count.total }, (_, index) => {
    const memberNumber = index + 1;
    const memberNumberLabel = String(memberNumber).padStart(2, "0");
    const linked = memberNumber <= input.count.linked;
    const name = StoryMemberNames[index] ?? `Member ${memberNumberLabel}`;

    return {
      userId: `usr_${input.idPrefix}_${memberNumberLabel}`,
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@${input.emailDomain}`,
      linked,
      statusLabel: linked ? "Linked" : "Not linked",
    };
  });
}
