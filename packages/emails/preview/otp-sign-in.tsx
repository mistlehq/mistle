import { PreviewMetadataLayout } from "../preview-support/preview-metadata.js";
import { EmailOTPTemplate, type EmailOTPTemplateProps } from "../src/templates/otp/template.js";

export const templateName = "OTP Sign In";
const subject = "Your Mistle sign-in code";
const title = "Your sign-in code";

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
