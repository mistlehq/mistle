import type { AppPageMeta } from "../navigation/route-meta.js";
import { FormPageHeader } from "./form-page.js";

export type PageFrameProps = {
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerIcon?: React.ReactNode;
  maxWidthClassName?: string;
  paddingClassName?: string;
  title: React.ReactNode;
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

function shouldRenderPageFrameHeader(input: Omit<PageFrameProps, "children">): boolean {
  const hasTitle =
    typeof input.title === "string"
      ? input.title.trim().length > 0
      : input.title !== null && input.title !== undefined;
  const hasDescription = input.description !== undefined && input.description !== null;
  const hasHeaderActions = input.headerActions !== undefined && input.headerActions !== null;
  const hasHeaderIcon = input.headerIcon !== undefined && input.headerIcon !== null;

  return hasTitle || hasDescription || hasHeaderActions || hasHeaderIcon;
}

export function PageFrame(input: PageFrameProps): React.JSX.Element {
  const shouldRenderHeader = shouldRenderPageFrameHeader(input);
  const hasBreadcrumbs = input.breadcrumbs !== undefined && input.breadcrumbs !== null;
  const contentClassName =
    input.maxWidthClassName === undefined ? undefined : `mx-auto w-full ${input.maxWidthClassName}`;
  const paddingClassName = input.paddingClassName ?? "px-4 py-6";

  return (
    <div className={`flex min-h-full flex-col gap-4 ${paddingClassName}`}>
      {hasBreadcrumbs || shouldRenderHeader ? (
        <div className={contentClassName}>
          <div className="flex flex-col gap-2">
            {input.breadcrumbs}
            {shouldRenderHeader ? (
              <FormPageHeader
                actions={input.headerActions}
                description={input.description}
                icon={input.headerIcon}
                title={input.title}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <div className={contentClassName}>{input.children}</div>
    </div>
  );
}

export function FormPageFrame(input: PageFrameProps): React.JSX.Element {
  const shouldRenderHeader = shouldRenderPageFrameHeader(input);
  const hasBreadcrumbs = input.breadcrumbs !== undefined && input.breadcrumbs !== null;

  return (
    <div className="flex min-h-full flex-col gap-6 bg-muted/30 px-4 py-6">
      {hasBreadcrumbs || shouldRenderHeader ? (
        <div className="mx-auto w-full max-w-2xl">
          <div className="flex flex-col gap-2">
            {input.breadcrumbs}
            {shouldRenderHeader ? (
              <FormPageHeader
                actions={input.headerActions}
                description={input.description}
                icon={input.headerIcon}
                title={input.title}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-2xl">{input.children}</div>
    </div>
  );
}
