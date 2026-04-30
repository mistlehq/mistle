import { cn } from "@mistle/ui";

import type { AppPageMeta } from "../navigation/route-meta.js";
import { FormPageHeader } from "./form-page.js";

export type PageFrameWidth = "form" | "full" | "normal";
export type PageFrameVariant = "default" | "tabbed";

export type PageFrameProps = {
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  description?: React.ReactNode;
  headerActions?: React.ReactNode;
  headerIcon?: React.ReactNode;
  title?: React.ReactNode;
  titleSlot?: React.ReactNode;
  variant?: PageFrameVariant;
  width?: PageFrameWidth;
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
  const hasTitleSlot = input.titleSlot !== undefined && input.titleSlot !== null;
  const hasDescription = input.description !== undefined && input.description !== null;
  const hasHeaderActions = input.headerActions !== undefined && input.headerActions !== null;
  const hasHeaderIcon = input.headerIcon !== undefined && input.headerIcon !== null;

  return hasTitle || hasTitleSlot || hasDescription || hasHeaderActions || hasHeaderIcon;
}

export function PageFrame(input: PageFrameProps): React.JSX.Element {
  const variant = input.variant ?? "default";
  const shouldRenderHeader = shouldRenderPageFrameHeader(input);
  const hasBreadcrumbs = input.breadcrumbs !== undefined && input.breadcrumbs !== null;
  const contentClassName = resolvePageFrameContentClassName(input.width ?? "full");
  const renderedHeader =
    hasBreadcrumbs || shouldRenderHeader ? (
      <div className={contentClassName}>
        <div className="flex flex-col gap-2">
          {input.breadcrumbs}
          {shouldRenderHeader ? (
            <FormPageHeader
              actions={input.headerActions}
              description={input.description}
              icon={input.headerIcon}
              title={input.title}
              titleSlot={input.titleSlot}
            />
          ) : null}
        </div>
      </div>
    ) : null;

  if (variant === "tabbed") {
    return (
      <div className="flex min-h-full flex-col">
        {renderedHeader === null ? null : (
          <div className="p-4" data-slot="page-frame-above-tabs">
            {renderedHeader}
          </div>
        )}
        <div className="min-h-0 flex-1" data-slot="page-frame-below-tabs">
          {input.children}
        </div>
      </div>
    );
  }

  const rootClassName = cn(
    "flex min-h-full flex-col",
    input.width === "form" ? "gap-6 bg-muted/30" : "gap-4",
    "p-4",
  );

  return (
    <div className={rootClassName}>
      {renderedHeader}
      <div className={contentClassName}>{input.children}</div>
    </div>
  );
}

function resolvePageFrameContentClassName(width: PageFrameWidth): string | undefined {
  switch (width) {
    case "form":
      return "mx-auto w-full max-w-2xl";
    case "full":
      return undefined;
    case "normal":
      return "mx-auto w-full max-w-5xl";
  }
}
