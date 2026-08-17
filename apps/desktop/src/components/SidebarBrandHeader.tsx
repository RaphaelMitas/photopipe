import { Photopipe } from "@photopipe/ui/components/photopipe-mark";
import { PhotopipeWordmark } from "@photopipe/ui/components/photopipe-wordmark";
import {
  SidebarHeader,
  SidebarTrigger,
} from "@photopipe/ui/components/sidebar";

export function SidebarBrandHeader() {
  return (
    <SidebarHeader>
      <div className="flex items-center gap-2 px-2 py-1">
        <Photopipe className="h-6 w-6 shrink-0" />
        <PhotopipeWordmark className="font-heading font-semibold tracking-tight" />
        <SidebarTrigger
          className="ml-auto text-muted-foreground"
          title="Hide sidebar (⌘B)"
        />
      </div>
    </SidebarHeader>
  );
}
