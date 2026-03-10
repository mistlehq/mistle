import { createMailpitInbox, type MailpitInbox, type MailpitService } from "@mistle/test-harness";
import { readTestContext } from "@mistle/test-harness";
import { it as vitestIt } from "vitest";
import { z } from "zod";

type MailpitIntegrationService = MailpitInbox & Pick<MailpitService, "smtpHost" | "smtpPort">;
const TestContextId = "emails.integration";
const MailpitIntegrationContextSchema = z
  .object({
    smtpHost: z.string().min(1),
    smtpPort: z.number().int().min(1).max(65_535),
    httpBaseUrl: z.url(),
  })
  .strict();

export const it = vitestIt.extend<{ mailpitService: MailpitIntegrationService }>({
  mailpitService: [
    async ({}, use) => {
      const { smtpHost, smtpPort, httpBaseUrl } = await readTestContext({
        id: TestContextId,
        schema: MailpitIntegrationContextSchema,
      });
      const inbox = createMailpitInbox({
        httpBaseUrl,
      });

      await use({
        smtpHost,
        smtpPort,
        listMessages: inbox.listMessages,
        getMessageSummary: inbox.getMessageSummary,
        waitForMessage: inbox.waitForMessage,
      });
    },
    {
      scope: "file",
    },
  ],
});
