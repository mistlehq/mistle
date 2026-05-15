import { cn, DetailLabel } from "@mistle/ui";
import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";

export type ResponsiveFieldListColumn = {
  key: string;
  label: ReactNode;
  desktopWidth: string;
  align?: "start" | "center" | "end";
  headerClassName?: string;
  cellClassName?: string;
  mobileLabelClassName?: string;
  hideMobileLabel?: boolean;
};

type ResponsiveFieldListContextValue = {
  columns: readonly ResponsiveFieldListColumn[];
};

type ResponsiveFieldListStyle = CSSProperties & {
  "--responsive-field-list-grid-template": string;
};

const ResponsiveFieldListContext = createContext<ResponsiveFieldListContextValue | null>(null);

function useResponsiveFieldListContext(): ResponsiveFieldListContextValue {
  const context = useContext(ResponsiveFieldListContext);

  if (context === null) {
    throw new Error("ResponsiveFieldList components must be rendered inside ResponsiveFieldList.");
  }

  return context;
}

function resolveColumn(
  columns: readonly ResponsiveFieldListColumn[],
  columnKey: string,
): ResponsiveFieldListColumn {
  const column = columns.find((candidate) => candidate.key === columnKey);

  if (column === undefined) {
    throw new Error(`ResponsiveFieldList column '${columnKey}' is not defined.`);
  }

  return column;
}

function resolveAlignmentClassName(align: ResponsiveFieldListColumn["align"]): string | null {
  if (align === "center") {
    return "@3xl/responsive-field-list:flex @3xl/responsive-field-list:justify-center";
  }

  if (align === "end") {
    return "@3xl/responsive-field-list:flex @3xl/responsive-field-list:justify-end";
  }

  return null;
}

export function ResponsiveFieldList(input: {
  children: ReactNode;
  className?: string;
  columns: readonly ResponsiveFieldListColumn[];
  gapClassName?: string;
  headerClassName?: string;
}): React.JSX.Element {
  const gridStyle: ResponsiveFieldListStyle = {
    "--responsive-field-list-grid-template": input.columns
      .map((column) => column.desktopWidth)
      .join(" "),
  };

  return (
    <ResponsiveFieldListContext.Provider value={{ columns: input.columns }}>
      <div
        className={cn("@container/responsive-field-list flex flex-col", input.className)}
        data-slot="responsive-field-list"
      >
        <div
          className={cn(
            "hidden border-b @3xl/responsive-field-list:grid @3xl/responsive-field-list:grid-cols-[var(--responsive-field-list-grid-template)]",
            input.gapClassName ?? "gap-4",
            input.headerClassName ?? "py-2",
          )}
          data-slot="responsive-field-list-header"
          style={gridStyle}
        >
          {input.columns.map((column) => (
            <DetailLabel
              as="div"
              className={cn(
                "min-w-0",
                column.align === "center" ? "text-center" : null,
                column.align === "end" ? "text-right" : null,
                column.headerClassName,
              )}
              key={column.key}
            >
              {column.label}
            </DetailLabel>
          ))}
        </div>
        {input.children}
      </div>
    </ResponsiveFieldListContext.Provider>
  );
}

export function ResponsiveFieldListRow(input: {
  children: ReactNode;
  className?: string;
  gapClassName?: string;
  gridClassName?: string;
  isLastRow?: boolean;
  status?: ReactNode;
  statusClassName?: string;
}): React.JSX.Element {
  const { columns } = useResponsiveFieldListContext();
  const gridStyle: ResponsiveFieldListStyle = {
    "--responsive-field-list-grid-template": columns.map((column) => column.desktopWidth).join(" "),
  };

  return (
    <div
      className={cn(input.isLastRow === true ? null : "border-b", input.className)}
      data-slot="responsive-field-list-row"
    >
      <div
        className={cn(
          "relative grid @3xl/responsive-field-list:items-center @3xl/responsive-field-list:grid-cols-[var(--responsive-field-list-grid-template)]",
          input.gapClassName ?? "gap-4",
          input.gridClassName,
        )}
        data-slot="responsive-field-list-row-grid"
        style={gridStyle}
      >
        {input.children}
      </div>
      {input.status === undefined || input.status === null ? null : (
        <div className={cn("text-muted-foreground text-sm", input.statusClassName)}>
          {input.status}
        </div>
      )}
    </div>
  );
}

export function ResponsiveFieldListCell(input: {
  children?: ReactNode;
  className?: string;
  columnKey: string;
  contentClassName?: string;
  hideOnMobile?: boolean;
  mobileLabelClassName?: string;
}): React.JSX.Element {
  const { columns } = useResponsiveFieldListContext();
  const column = resolveColumn(columns, input.columnKey);

  return (
    <div
      className={cn(
        "min-w-0",
        input.hideOnMobile === true ? "hidden @3xl/responsive-field-list:block" : null,
        resolveAlignmentClassName(column.align),
        column.cellClassName,
        input.className,
      )}
      data-column-key={input.columnKey}
      data-slot="responsive-field-list-cell"
    >
      {column.hideMobileLabel === true ? null : (
        <DetailLabel
          as="div"
          className={cn(
            "mb-1 @3xl/responsive-field-list:hidden",
            column.mobileLabelClassName,
            input.mobileLabelClassName,
          )}
          data-slot="responsive-field-list-mobile-label"
        >
          {column.label}
        </DetailLabel>
      )}
      <div className={input.contentClassName}>{input.children}</div>
    </div>
  );
}
