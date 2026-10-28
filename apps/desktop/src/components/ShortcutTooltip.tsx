import { Kbd } from "@photopipe/ui/components/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@photopipe/ui/components/tooltip";
import type { ReactElement } from "react";
import type { ActionId } from "@/lib/keymap";
import { flagPref } from "@/lib/pref";
import { releaseEscape, useShortcutLabel } from "@/lib/shortcuts";

export const tooltipsPref = flagPref("photopipe.tooltips", "on", "off", true);

type Props = {
  label: string;
  action?: ActionId;
  children: ReactElement;
};

export function ShortcutTooltip({ label, action, children }: Props) {
  const on = tooltipsPref.use();
  const key = useShortcutLabel(action);
  if (!on) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent onEscapeKeyDown={releaseEscape}>
        {label}
        {key && <Kbd>{key}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
