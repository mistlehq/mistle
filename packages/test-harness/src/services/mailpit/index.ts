import { systemClock, systemSleeper } from "@mistle/time";
import {
  MailpitClient,
  type MailpitMessageListItem,
  type MailpitMessageSummaryResponse,
} from "mailpit-api";
import { GenericContainer, type StartedNetwork, type StartedTestContainer } from "testcontainers";

import { registerProcessCleanupTask } from "../../cleanup/index.js";

const MAILPIT_SMTP_PORT = 1025;
const MAILPIT_HTTP_PORT = 8025;
const MAILPIT_IMAGE = "axllent/mailpit:v1.28";
const MAILPIT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAILPIT_NETWORK_ALIAS = "mailpit";

export type StartMailpitInput = {
  manageProcessCleanup?: boolean;
  containerLabels?: Record<string, string>;
  network?: StartedNetwork;
  networkAlias?: string;
};

export type MailpitService = {
  smtpHost: string;
  smtpPort: number;
  httpBaseUrl: string;
  listMessages: () => Promise<readonly MailpitMessageListItem[]>;
  getMessageSummary: (id: string) => Promise<MailpitMessageSummaryResponse>;
  waitForMessage: (input: {
    matcher: (input: {
      messages: readonly MailpitMessageListItem[];
      message: MailpitMessageListItem;
      index: number;
    }) => boolean;
    timeoutMs: number;
    description?: string;
  }) => Promise<MailpitMessageListItem>;
  runtimeMetadata: {
    containerId: string;
  };
  stop: () => Promise<void>;
};

export type MailpitInbox = Pick<
  MailpitService,
  "listMessages" | "getMessageSummary" | "waitForMessage"
>;

async function listMessages(client: MailpitClient): Promise<readonly MailpitMessageListItem[]> {
  const response = await client.listMessages();
  return response.messages;
}

async function waitForMessage(input: {
  listMessages: () => Promise<readonly MailpitMessageListItem[]>;
  matcher: (input: {
    messages: readonly MailpitMessageListItem[];
    message: MailpitMessageListItem;
    index: number;
  }) => boolean;
  timeoutMs: number;
  description?: string;
}): Promise<MailpitMessageListItem> {
  const deadline = systemClock.nowMs() + input.timeoutMs;

  while (systemClock.nowMs() < deadline) {
    const messages = await input.listMessages();
    const matched = messages.find((message, index) =>
      input.matcher({
        messages,
        message,
        index,
      }),
    );

    if (matched !== undefined) {
      return matched;
    }

    await systemSleeper.sleep(MAILPIT_POLL_INTERVAL_MS);
  }

  throw new Error(
    input.description === undefined
      ? `Timed out waiting for a matching Mailpit message within ${input.timeoutMs}ms.`
      : `Timed out waiting for Mailpit message (${input.description}) within ${input.timeoutMs}ms.`,
  );
}

export async function startMailpit(input: StartMailpitInput = {}): Promise<MailpitService> {
  let container: StartedTestContainer | undefined;
  let stopped = false;

  let containerDefinition = new GenericContainer(MAILPIT_IMAGE).withExposedPorts(
    MAILPIT_SMTP_PORT,
    MAILPIT_HTTP_PORT,
  );
  containerDefinition = containerDefinition.withLabels(input.containerLabels ?? {});

  if (input.network !== undefined) {
    containerDefinition = containerDefinition
      .withNetwork(input.network)
      .withNetworkAliases(input.networkAlias ?? DEFAULT_MAILPIT_NETWORK_ALIAS);
  }

  container = await containerDefinition.start();

  const smtpHost = container.getHost();
  const smtpPort = container.getMappedPort(MAILPIT_SMTP_PORT);
  const httpBaseUrl = `http://${container.getHost()}:${container.getMappedPort(MAILPIT_HTTP_PORT)}`;
  const client = new MailpitClient(httpBaseUrl);

  const stopInternal = async (): Promise<void> => {
    stopped = true;

    if (container === undefined) {
      throw new Error("Mailpit container was not started.");
    }

    await container.stop({
      remove: true,
      removeVolumes: true,
      timeout: 0,
    });
    container = undefined;
  };

  const unregisterProcessCleanupTask =
    (input.manageProcessCleanup ?? true)
      ? registerProcessCleanupTask(async () => {
          if (stopped || container === undefined) {
            return;
          }

          await stopInternal();
        })
      : () => {};

  return {
    smtpHost,
    smtpPort,
    httpBaseUrl,
    listMessages: async () => listMessages(client),
    getMessageSummary: async (id: string) => client.getMessageSummary(id),
    waitForMessage: (input) =>
      waitForMessage({
        listMessages: async () => listMessages(client),
        matcher: input.matcher,
        timeoutMs: input.timeoutMs,
        ...(input.description === undefined
          ? {}
          : {
              description: input.description,
            }),
      }),
    runtimeMetadata: {
      containerId: container.getId(),
    },
    stop: async () => {
      if (stopped) {
        throw new Error("Mailpit container was already stopped.");
      }

      await stopInternal();
      unregisterProcessCleanupTask();
    },
  };
}

export function createMailpitInbox(input: { httpBaseUrl: string }): MailpitInbox {
  const client = new MailpitClient(input.httpBaseUrl);

  return {
    listMessages: async () => listMessages(client),
    getMessageSummary: async (id: string) => client.getMessageSummary(id),
    waitForMessage: (waitInput) =>
      waitForMessage({
        listMessages: async () => listMessages(client),
        matcher: waitInput.matcher,
        timeoutMs: waitInput.timeoutMs,
        ...(waitInput.description === undefined
          ? {}
          : {
              description: waitInput.description,
            }),
      }),
  };
}
