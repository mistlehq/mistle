import { Section, Text } from "jsx-email";
import type { CSSProperties, ReactElement } from "react";

import { BrandedEmailShell } from "../shared/branded-email-shell.js";

export type OrganizationInvitationTemplateProps = {
  organizationName: string;
  inviterDisplayName: string;
  preview: string;
  role: string;
  invitationUrl: string;
};

const paragraphStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 18px",
  textAlign: "center",
};

const buttonSectionStyle: CSSProperties = {
  margin: "20px 0 28px",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  backgroundColor: "#111827",
  borderRadius: "10px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: 700,
  padding: "14px 22px",
  textDecoration: "none",
};

const footerStyle: CSSProperties = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  textAlign: "center",
};

const fallbackPromptStyle: CSSProperties = {
  ...footerStyle,
  margin: "0 0 4px",
};

const fallbackLinkStyle: CSSProperties = {
  color: "#111827",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0 0 18px",
  textAlign: "center",
  wordBreak: "break-all",
};

const ignoreMessageStyle: CSSProperties = {
  ...footerStyle,
  margin: 0,
};

export function OrganizationInvitationTemplate({
  organizationName,
  inviterDisplayName,
  preview,
  role,
  invitationUrl,
}: OrganizationInvitationTemplateProps): ReactElement {
  const subject = `Join ${organizationName} on Mistle`;

  return (
    <BrandedEmailShell preview={preview} title={subject}>
      <Text style={paragraphStyle}>
        {`${inviterDisplayName} invited you to join ${organizationName} as ${role}.`}
      </Text>
      <Section style={buttonSectionStyle}>
        <a href={invitationUrl} style={buttonStyle}>
          Accept invitation
        </a>
      </Section>
      <Text style={fallbackPromptStyle}>If the button does not work, use this link:</Text>
      <Text style={fallbackLinkStyle}>{invitationUrl}</Text>
      <Text style={ignoreMessageStyle}>
        If you did not expect this invitation, you can ignore this email.
      </Text>
    </BrandedEmailShell>
  );
}
