import type { AppPageMeta } from "../navigation/route-meta.js";
import { FormPageHeader } from "./form-page.js";

export type PageFrameProps = {
  children: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerIcon?: React.ReactNode;
  title: React.ReactNode;
  variant?: "default" | "form";
};

export function resolvePageFrameText(
  pageMeta: AppPageMeta,
  fallbackTitle: string,
): {
  description: string | undefined;
  title: string;
} {
  return {
    description:
      pageMeta.supportingText === null || pageMeta.supportingText.trim().length === 0
        ? undefined
        : pageMeta.supportingText,
    title: pageMeta.title ?? fallbackTitle,
  };
}

export function PageFrame(input: PageFrameProps): React.JSX.Element {
  const isFormLayout = input.variant === "form";

  return (
    <div
      className={
        isFormLayout
          ? "flex min-h-full flex-col gap-3 bg-muted/30 px-4 py-6"
          : "flex min-h-full flex-col gap-4 px-4 py-6"
      }
    >
      <div className={isFormLayout ? "mx-auto w-full max-w-2xl" : undefined}>
        <FormPageHeader
          actions={input.headerActions}
          description={input.description}
          icon={input.headerIcon}
          title={input.title}
        />
      </div>
      {input.children}
    </div>
  );
}
