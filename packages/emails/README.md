# @mistle/emails

Type-safe email rendering + sending package.

This package keeps template internals private and exposes a simple public API:

- `sendEmail(...)`
- runtime sender(s), currently `SMTPEmailSender`
- template IDs via `EmailTemplateIds`

Template rendering is powered by `jsx-email`.

For tests, use the dedicated testing subpath:

- `@mistle/emails/testing` (currently `InMemoryEmailSender`)

## Public API

From `@mistle/emails`:

- `sendEmail`
- `EmailSendError`
- `SMTPEmailSender`
- `EmailTemplateIds`
- sender/message/result types (`EmailSender`, `EmailMessage`, `SendEmailResult`, etc.)

From `@mistle/emails/testing`:

- `InMemoryEmailSender`

## Runtime Usage

```ts
import { EmailTemplateIds, SMTPEmailSender, sendEmail } from "@mistle/emails";

const sender = SMTPEmailSender.fromTransportOptions({
  host: "localhost",
  port: 1025,
  secure: false,
});

await sendEmail({
  sender,
  from: { email: "no-reply@mistle.dev", name: "Mistle" },
  to: [{ email: "user@mistle.dev" }],
  templateId: EmailTemplateIds.OTP,
  templateInput: {
    otp: "123456",
    type: "sign-in",
    expiresInSeconds: 300,
  },
});
```

`sendEmail` renders the template using `templateId` + `templateInput`, then sends it through the provided sender.
On sender failure, it throws `EmailSendError`.

## Testing Usage

```ts
import { EmailTemplateIds, sendEmail } from "@mistle/emails";
import { InMemoryEmailSender } from "@mistle/emails/testing";

const sender = new InMemoryEmailSender();

await sendEmail({
  sender,
  from: { email: "no-reply@mistle.dev" },
  to: [{ email: "user@mistle.dev" }],
  templateId: EmailTemplateIds.OTP,
  templateInput: {
    otp: "123456",
    type: "sign-in",
    expiresInSeconds: 300,
  },
});

expect(sender.sent).toHaveLength(1);
```

## Template Registry

Templates are selected by ID, not by importing template modules directly from apps.
To add a new template:

1. Implement template files under `src/templates/<template>/`.
2. Add a new ID in `src/templates/template-ids.ts`.
3. Add typed input mapping + builder wiring in `src/templates/registry.ts`.
4. `sendEmail` will then accept the new `templateId` with its corresponding typed `templateInput`.

## Scripts

- `pnpm --filter @mistle/emails build`
- `pnpm --filter @mistle/emails lint`
- `pnpm --filter @mistle/emails typecheck`
- `pnpm --filter @mistle/emails test`
- `pnpm --filter @mistle/emails test:integration`
- `pnpm --filter @mistle/emails test:all`
- `pnpm --filter @mistle/emails preview`
- `pnpm --filter @mistle/emails preview:build`
- `pnpm --filter @mistle/emails format`
- `pnpm --filter @mistle/emails format:check`

## Previewing Templates

`jsx-email`'s preview CLI expects template entry files that export `Template`,
`templateName`, and `previewProps`. This package keeps runtime template builders
under `src/templates`, so preview-only entry files live under `preview/`.

This repo currently runs on Node 25, while `jsx-email` still calls the removed
recursive `rmdir` API in its preview CLI. The preview scripts use a local
compatibility wrapper under `scripts/jsx-email-cli-compat.mjs` so previewing
works without patching `node_modules`.

Use either of these commands from the repo root:

- `pnpm emails:preview`
- `pnpm emails:preview:build`
