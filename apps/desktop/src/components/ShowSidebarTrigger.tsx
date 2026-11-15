import { SidebarTrigger, useSidebar } from "@photopipe/ui/components/sidebar";
import { useShortcuts } from "@/lib/shortcuts";
import { ShortcutTooltip } from "./ShortcutTooltip";

export function ShowSidebarTrigger() {
  const { isMobile, state, toggleSidebar } = useSidebar();
  useShortcuts({ "sidebar.toggle": toggleSidebar });

  if (!isMobile && state === "expanded") return null;

  return (
    <ShortcutTooltip label="Show sidebar" action="sidebar.toggle">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
    </ShortcutTooltip>
  );
}
