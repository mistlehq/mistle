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

import { useAppBreadcrumbs } from "./route-meta.js";

export function AppBreadcrumbs(): React.JSX.Element | null {
  const breadcrumbs = useAppBreadcrumbs();
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
                  <BreadcrumbPage>
                    <span
                      className="inline-block max-w-40 truncate align-bottom"
                      title={breadcrumb.label}
                    >
                      {breadcrumb.label}
                    </span>
                  </BreadcrumbPage>
                ) : breadcrumb.to !== null ? (
                  <BreadcrumbLink render={<NavLink to={breadcrumb.to} />}>
                    <span
                      className="inline-block max-w-40 truncate align-bottom"
                      title={breadcrumb.label}
                    >
                      {breadcrumb.label}
                    </span>
                  </BreadcrumbLink>
                ) : (
                  <span
                    aria-disabled="true"
                    aria-label={`${breadcrumb.label} (not navigable)`}
                    className="text-muted-foreground inline-block max-w-40 truncate"
                    title={breadcrumb.label}
                  >
                    {breadcrumb.label}
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
