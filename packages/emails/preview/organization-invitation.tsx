import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import {
  OrganizationInvitationTemplate,
  type OrganizationInvitationTemplateProps,
} from "../src/templates/organization-invitation/template.js";

export const templateName = "Organization Invitation";
const subject = "Join Acme on Mistle";
const preview = "Jane Doe invited you to join as admin.";

export const previewProps: OrganizationInvitationTemplateProps = {
  organizationName: "Acme",
  inviterDisplayName: "Jane Doe",
  preview,
  role: "admin",
  invitationUrl: "https://example.com/accept?invitationId=inv_123",
};

export function Template(props: OrganizationInvitationTemplateProps) {
  return (
    <PreviewMetadataLayout preview={preview} subject={subject} templateName={templateName}>
      <OrganizationInvitationTemplate {...props} />
    </PreviewMetadataLayout>
  );
}
