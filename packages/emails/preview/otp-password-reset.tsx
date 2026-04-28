import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Password Reset";
const subject = "Your Mistle password reset code";
const title = "Your password reset code";

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
