import { SidebarTrigger, useSidebar } from "@photopipe/ui/components/sidebar";
import { useShortcuts } from "@/lib/shortcuts";
import { ShortcutTooltip } from "./ShortcutTooltip";

export function ShowSidebarTrigger() {
  const { isMobile, state, toggleSidebar } = useSidebar();
  // The header outlives both sidebars, which unmount as a sheet on mobile.
  useShortcuts({ "sidebar.toggle": toggleSidebar });

  // On mobile it stays mounted under the overlay, so the sheet can hand focus back.
  if (!isMobile && state === "expanded") return null;

  return (
    <ShortcutTooltip label="Show sidebar" action="sidebar.toggle">
      <SidebarTrigger className="-ml-1 text-muted-foreground" />
    </ShortcutTooltip>
  );
}
