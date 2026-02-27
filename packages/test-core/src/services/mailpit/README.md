# Mailpit Service

Starts and manages a real Mailpit container for tests.

## Exports

From [`index.ts`](./index.ts):

- `startMailpit(): Promise<MailpitService>`
- `MailpitService`
  - `smtpHost: string`
  - `smtpPort: number`
  - `httpBaseUrl: string`
  - `listMessages(): Promise<readonly MailpitMessageListItem[]>`
  - `getMessageSummary(id: string): Promise<MailpitMessageSummaryResponse>`
  - `waitForMessage({ matcher, timeoutMs, description? }): Promise<MailpitMessageListItem>`
  - `stop(): Promise<void>`

## Usage Pattern

Use file-scoped setup in Vitest and always stop in teardown.

```ts
import { startMailpit, type MailpitService } from "@mistle/test-core";
import { it as vitestIt } from "vitest";

export const it = vitestIt.extend<{ mailpitService: MailpitService }>({
  mailpitService: [
    async ({}, use) => {
      const mailpitService = await startMailpit();
      await use(mailpitService);
      await mailpitService.stop();
    },
    { scope: "file" },
  ],
});
```

## Waiting For Messages

Prefer `waitForMessage` over manual polling/sleeps.

- `matcher` receives `{ messages, message, index }`
- `timeoutMs` is required
- `description` is optional and appears in timeout errors

```ts
const message = await mailpitService.waitForMessage({
  timeoutMs: 10_000,
  description: "subject: welcome",
  matcher: ({ message }) => message.Subject === "Welcome",
});
```

Use `getMessageSummary` when you need full message content (body, recipients, attachments, headers).

```ts
const summary = await mailpitService.getMessageSummary(message.ID);
expect(summary.Text).toContain("Welcome");
```

## Lifecycle

- `stop()` is required.
- Calling `stop()` twice throws.
- No fallback behavior is applied for startup/teardown failures.
