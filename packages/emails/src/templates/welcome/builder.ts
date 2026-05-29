import type { EmailTemplate, EmailTemplateMetadata } from "../../render.js";
import { buildWelcomeEmailContent } from "./content.js";

export type BuildWelcomeTemplateOptions = {
  callUrl?: string | undefined;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildMetadata(input: BuildWelcomeTemplateOptions): EmailTemplateMetadata {
  const content = buildWelcomeEmailContent(input);

  return {
    templateName: content.templateName,
    subject: content.subject,
  };
}

function buildText(input: BuildWelcomeTemplateOptions): string {
  const content = buildWelcomeEmailContent(input);
  const lines = [
    content.greeting,
    "",
    content.intro,
    "",
    content.helpHeading,
    ...content.helpItems.map((item) =>
      item.kind === "call" ? `- ${item.text} ${item.callUrl}.` : `- ${item.text}`,
    ),
  ];

  lines.push("", content.useCaseRequest, "", content.signoff.valediction, content.signoff.name);

  return lines.join("\n");
}

function buildHtml(input: BuildWelcomeTemplateOptions): string {
  const content = buildWelcomeEmailContent(input);

  return [
    `<p>${escapeHtml(content.greeting)}</p>`,
    `<p>${escapeHtml(content.intro)}</p>`,
    `<p>${escapeHtml(content.helpHeading)}</p>`,
    "<ul>",
    ...content.helpItems.map((item) =>
      item.kind === "call"
        ? `<li>${escapeHtml(item.text)} <a href="${escapeHtml(item.callUrl)}">${escapeHtml(item.callUrl)}</a>.</li>`
        : `<li>${escapeHtml(item.text)}</li>`,
    ),
    "</ul>",
    `<p>${escapeHtml(content.useCaseRequest)}</p>`,
    `<p>${escapeHtml(content.signoff.valediction)}<br>${escapeHtml(content.signoff.name)}</p>`,
  ].join("\n");
}

export async function buildWelcomeTemplate(
  input: BuildWelcomeTemplateOptions,
): Promise<EmailTemplate> {
  const metadata = buildMetadata(input);

  return {
    metadata,
    subject: metadata.subject,
    html: buildHtml(input),
    text: buildText(input),
  };
}
