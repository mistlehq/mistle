import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

export type StartConversationSessionResult = {
  conversationId: string;
  routeId: string;
  sandboxInstanceId: string;
  workflowRunId: string | null;
};

export type CreateSandboxConversationsServiceInput = {
  db: ControlPlaneDatabase;
  defaultBaseImage: string;
  sandboxProfiles: {
    startProfileInstance: (input: {
      organizationId: string;
      profileId: string;
      profileVersion: number;
      startedBy: {
        kind: "user" | "system";
        id: string;
      };
      source: "dashboard" | "webhook";
      restoreFromSourceInstanceId?: string;
      sandboxInstanceId?: string;
      image: {
        imageId: string;
        kind: "base" | "snapshot";
        createdAt: string;
      };
    }) => Promise<{
      workflowRunId: string;
      sandboxInstanceId: string;
    }>;
  };
  sandboxInstances: {
    getInstance: (input: { organizationId: string; instanceId: string }) => Promise<{
      id: string;
      status: "starting" | "running" | "stopped" | "failed";
      failureCode: string | null;
      failureMessage: string | null;
    }>;
    mintConnectionToken: (input: { organizationId: string; instanceId: string }) => Promise<{
      instanceId: string;
      url: string;
      token: string;
      expiresAt: string;
    }>;
  };
};

export type SandboxConversationsService = {
  startSession: (input: {
    organizationId: string;
    userId: string;
    profileId: string;
    profileVersion: number;
    integrationBindingId: string;
  }) => Promise<StartConversationSessionResult>;
  continueSession: (input: {
    organizationId: string;
    userId: string;
    conversationId: string;
  }) => Promise<StartConversationSessionResult>;
};
