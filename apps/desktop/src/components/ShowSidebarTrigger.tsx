import { SidebarTrigger, useSidebar } from "@photopipe/ui/components/sidebar";

export function ShowSidebarTrigger() {
  const { isMobile, state } = useSidebar();

  // On mobile it stays mounted under the overlay, so the sheet can hand focus back.
  if (!isMobile && state === "expanded") return null;

  return (
    <SidebarTrigger
      className="-ml-1 text-muted-foreground"
      title="Show sidebar (⌘B)"
    />
  );
}
