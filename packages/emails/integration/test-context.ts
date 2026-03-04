import { createMailpitInbox, type MailpitInbox, type MailpitService } from "@mistle/test-harness";
import { it as vitestIt } from "vitest";

type MailpitIntegrationService = MailpitInbox & Pick<MailpitService, "smtpHost" | "smtpPort">;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required integration environment variable: ${name}`);
  }

  return value;
}

function parsePort(input: { value: string; variableName: string }): number {
  const parsedPort = Number.parseInt(input.value, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Environment variable ${input.variableName} must be a valid TCP port.`);
  }

  return parsedPort;
}

export const it = vitestIt.extend<{ mailpitService: MailpitIntegrationService }>({
  mailpitService: [
    async ({}, use) => {
      const smtpHost = requireEnv("MISTLE_EMAILS_IT_MAILPIT_SMTP_HOST");
      const smtpPort = parsePort({
        value: requireEnv("MISTLE_EMAILS_IT_MAILPIT_SMTP_PORT"),
        variableName: "MISTLE_EMAILS_IT_MAILPIT_SMTP_PORT",
      });
      const httpBaseUrl = requireEnv("MISTLE_EMAILS_IT_MAILPIT_HTTP_BASE_URL");
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
