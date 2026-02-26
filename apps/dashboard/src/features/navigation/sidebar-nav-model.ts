export type SidebarNavMatchMode = "section" | "exact";

export type SidebarNavIcon = (props: {
  className?: string;
  "aria-hidden"?: boolean;
}) => React.JSX.Element;

export type SidebarNavItem = {
  readonly to: string;
  readonly label: string;
  readonly icon?: SidebarNavIcon;
  readonly matchMode?: SidebarNavMatchMode;
};

export type SidebarNavGroup = {
  readonly label?: string;
  readonly items: readonly SidebarNavItem[];
};

export function isSidebarNavItemActive(pathname: string, item: SidebarNavItem): boolean {
  if (item.matchMode === "exact") {
    return pathname === item.to;
  }

  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}
