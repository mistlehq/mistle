import type { EmailTemplate, EmailTemplateMetadata } from "../../render.js";

export type BuildWelcomeTemplateOptions = {
  callUrl?: string | undefined;
};

const Subject = "Welcome to Mistle";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildMetadata(): EmailTemplateMetadata {
  return {
    templateName: "Welcome",
    subject: Subject,
  };
}

function buildText(input: BuildWelcomeTemplateOptions): string {
  const callUrl = input.callUrl?.trim();
  const lines = [
    "Hey there,",
    "",
    "I'm Jonathan, one of the co-founders.",
    "",
    "Ways I can help:",
    "- Have feedback or questions? Reply to this email.",
    "- Support via Slack Connect. Reply to this email and I'd set it up.",
  ];

  if (callUrl !== undefined && callUrl.length > 0) {
    lines.push(`- Setup guidance/Use case exploration. Book a call: ${callUrl}.`);
  }

  lines.push(
    "",
    "Also, I'd really appreciate it if you can share what use cases you're exploring Mistle for. Just reply to this email with a line or two.",
    "",
    "Cheers,",
    "Jonathan",
  );

  return lines.join("\n");
}

function buildHtml(input: BuildWelcomeTemplateOptions): string {
  const callUrl = input.callUrl?.trim();
  const callUrlItem =
    callUrl === undefined || callUrl.length === 0
      ? ""
      : `<li>Setup guidance/Use case exploration. Book a call: <a href="${escapeHtml(callUrl)}">${escapeHtml(callUrl)}</a>.</li>`;

  return [
    "<p>Hey there,</p>",
    "<p>I'm Jonathan, one of the co-founders.</p>",
    "<p>Ways I can help:</p>",
    "<ul>",
    "<li>Have feedback or questions? Reply to this email.</li>",
    "<li>Support via Slack Connect. Reply to this email and I'd set it up.</li>",
    callUrlItem,
    "</ul>",
    "<p>Also, I'd really appreciate it if you can share what use cases you're exploring Mistle for. Just reply to this email with a line or two.</p>",
    "<p>Cheers,<br>Jonathan</p>",
  ].join("\n");
}

export async function buildWelcomeTemplate(
  input: BuildWelcomeTemplateOptions,
): Promise<EmailTemplate> {
  const metadata = buildMetadata();

  return {
    metadata,
    subject: metadata.subject,
    html: buildHtml(input),
    text: buildText(input),
  };
}
