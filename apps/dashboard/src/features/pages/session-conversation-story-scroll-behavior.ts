import type { SessionConversationScrollBehavior } from "./session-conversation-scroll-behavior.js";

export type SessionConversationScrollBehaviorStoryArg = {
  scrollBehavior: SessionConversationScrollBehavior;
};

export const SessionConversationScrollBehaviorOptions = [
  "pin-active-turn-to-top",
  "follow-streaming-at-bottom",
  "none",
] satisfies readonly SessionConversationScrollBehavior[];

export const SessionConversationScrollBehaviorArgType = {
  control: "radio",
  description: "Conversation scroll behavior for new and streaming turns.",
  options: SessionConversationScrollBehaviorOptions,
} as const;
