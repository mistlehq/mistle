import { Body, Container, Head, Html, Preview, Section, Text } from "jsx-email";
import type { CSSProperties, ReactElement } from "react";

export type OrganizationInvitationTemplateProps = {
  organizationName: string;
  inviterDisplayName: string;
  role: string;
  invitationUrl: string;
};

const bodyStyle: CSSProperties = {
  backgroundColor: "#f6f7fb",
  fontFamily: "Helvetica, Arial, sans-serif",
  margin: 0,
  padding: "32px 0",
};

const containerStyle: CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  margin: "0 auto",
  maxWidth: "520px",
  padding: "28px",
};

const headingStyle: CSSProperties = {
  color: "#111827",
  fontSize: "24px",
  fontWeight: 700,
  margin: "0 0 18px",
};

const paragraphStyle: CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "22px",
  margin: "0 0 16px",
};

const buttonSectionStyle: CSSProperties = {
  margin: "20px 0 22px",
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
  marginTop: "20px",
};

export function OrganizationInvitationTemplate({
  organizationName,
  inviterDisplayName,
  role,
  invitationUrl,
}: OrganizationInvitationTemplateProps): ReactElement {
  const subject = `You're invited to join ${organizationName}`;

  return (
    <Html>
      <Head />
      <Preview>{subject}</Preview>
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={headingStyle}>{subject}</Text>
          <Text style={paragraphStyle}>
            {`${inviterDisplayName} invited you to join ${organizationName} as ${role}.`}
          </Text>
          <Section style={buttonSectionStyle}>
            <a href={invitationUrl} style={buttonStyle}>
              Accept invitation
            </a>
          </Section>
          <Text style={footerStyle}>
            If you did not expect this invitation, you can ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
