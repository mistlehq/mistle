import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Email Verification";
const subject = "Verify your email for Mistle";
const title = "Verify your email";

export const previewProps: EmailOTPTemplateProps = {
  otp: "123456",
  expiresInSeconds: 300,
  title,
};

export function Template(props: EmailOTPTemplateProps) {
  return (
    <PreviewMetadataLayout subject={subject} templateName={templateName}>
      <EmailOTPTemplate {...props} />
    </PreviewMetadataLayout>
  );
}
