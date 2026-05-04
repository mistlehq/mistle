import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@mistle/ui";
import { Fragment } from "react";
import { NavLink } from "react-router";

import { useAppBreadcrumbs, useAppPageBreadcrumbModel } from "./route-meta.js";
import type { AppBreadcrumb } from "./route-meta.js";

export function AppBreadcrumbs(input: { breadcrumbs?: AppBreadcrumb[] }): React.JSX.Element | null {
  const routeBreadcrumbs = useAppBreadcrumbs();
  const breadcrumbs = input.breadcrumbs ?? routeBreadcrumbs;
  const shouldCollapseOnMobile = breadcrumbs.length > 2;

  if (breadcrumbs.length === 0) {
    return null;
  }

  return (
    <Breadcrumb aria-label="Page breadcrumbs" className="min-w-0 overflow-hidden">
      <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
        {breadcrumbs.map((breadcrumb, index) => {
          const lastIndex = breadcrumbs.length - 1;
          const isMiddleCrumb = index > 0 && index < lastIndex;
          const hideOnMobile = shouldCollapseOnMobile && isMiddleCrumb;
          const itemClassName = hideOnMobile
            ? "hidden min-w-0 max-w-full md:inline-flex"
            : "min-w-0 max-w-full";
          const separatorClassName =
            hideOnMobile && index < lastIndex ? "hidden md:list-item" : undefined;

          return (
            <Fragment key={`${breadcrumb.label}-${breadcrumb.to ?? "current"}-${index}`}>
              <BreadcrumbItem className={itemClassName}>
                {breadcrumb.isCurrent ? (
                  <BreadcrumbPage className="inline-flex items-center">
                    <span className="inline-flex max-w-full items-center gap-2 leading-tight">
                      {breadcrumb.icon === undefined ? null : (
                        <span aria-hidden className="shrink-0">
                          {breadcrumb.icon}
                        </span>
                      )}
                      <span
                        className="inline-block max-w-40 truncate leading-tight"
                        title={breadcrumb.label}
                      >
                        {breadcrumb.label}
                      </span>
                    </span>
                  </BreadcrumbPage>
                ) : breadcrumb.to !== null ? (
                  <BreadcrumbLink
                    className="inline-flex items-center"
                    render={<NavLink to={breadcrumb.to} />}
                  >
                    <span className="inline-flex max-w-full items-center gap-2 leading-tight">
                      {breadcrumb.icon === undefined ? null : (
                        <span aria-hidden className="shrink-0">
                          {breadcrumb.icon}
                        </span>
                      )}
                      <span
                        className="inline-block max-w-40 truncate leading-tight"
                        title={breadcrumb.label}
                      >
                        {breadcrumb.label}
                      </span>
                    </span>
                  </BreadcrumbLink>
                ) : (
                  <span className="inline-flex max-w-full items-center gap-2 leading-tight">
                    {breadcrumb.icon === undefined ? null : (
                      <span aria-hidden className="shrink-0">
                        {breadcrumb.icon}
                      </span>
                    )}
                    <span
                      aria-disabled="true"
                      aria-label={`${breadcrumb.label} (not navigable)`}
                      className="text-muted-foreground inline-block max-w-40 truncate leading-tight"
                      title={breadcrumb.label}
                    >
                      {breadcrumb.label}
                    </span>
                  </span>
                )}
              </BreadcrumbItem>

              {shouldCollapseOnMobile && index === 0 ? (
                <>
                  <BreadcrumbSeparator className="md:hidden" />
                  <BreadcrumbItem className="md:hidden">
                    <BreadcrumbEllipsis />
                  </BreadcrumbItem>
                </>
              ) : null}

              {index < lastIndex ? <BreadcrumbSeparator className={separatorClassName} /> : null}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function useAppPageBreadcrumbs(): React.ReactNode | null {
  const pageBreadcrumbModel = useAppPageBreadcrumbModel();

  if (pageBreadcrumbModel.kind === "custom") {
    return <>{pageBreadcrumbModel.content}</>;
  }

  if (pageBreadcrumbModel.kind === "breadcrumbs") {
    return <AppBreadcrumbs breadcrumbs={pageBreadcrumbModel.breadcrumbs} />;
  }

  return null;
}
