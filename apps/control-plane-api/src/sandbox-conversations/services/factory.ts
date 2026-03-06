import { continueConversationSession, startConversationSession } from "./session.js";
import type {
  CreateSandboxConversationsServiceInput,
  SandboxConversationsService,
} from "./types.js";

export type {
  CreateSandboxConversationsServiceInput,
  SandboxConversationsService,
} from "./types.js";
export {
  SandboxConversationsBadRequestCodes,
  SandboxConversationsBadRequestError,
  SandboxConversationsConflictCodes,
  SandboxConversationsConflictError,
  SandboxConversationsNotFoundCodes,
  SandboxConversationsNotFoundError,
} from "./errors.js";

export function createSandboxConversationsService(
  input: CreateSandboxConversationsServiceInput,
): SandboxConversationsService {
  return {
    startSession: (serviceInput) => startConversationSession(input, serviceInput),
    continueSession: (serviceInput) => continueConversationSession(input, serviceInput),
  } satisfies SandboxConversationsService;
}
