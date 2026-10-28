import { Button } from "@photopipe/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@photopipe/ui/components/dialog";
import { Kbd } from "@photopipe/ui/components/kbd";
import {
  ACTION_IDS,
  ACTIONS,
  type Context,
  chordsOf,
  formatChord,
  GROUPS,
} from "@/lib/keymap";
import { bindingsOf, useOverrides } from "@/lib/shortcuts";

const TITLES: Record<Context, string> = {
  browser: "Browser shortcuts",
  loupe: "Loupe shortcuts",
  crop: "Crop shortcuts",
};

type Props = {
  context: Context | null;
  onClose: () => void;
  onEdit: () => void;
};

export function ShortcutSheet({ context, onClose, onEdit }: Props) {
  const overrides = useOverrides();
  const here = context
    ? ACTION_IDS.filter(
        (id) =>
          ACTIONS[id].contexts.includes(context) &&
          bindingsOf(id, overrides).length > 0,
      )
    : [];
  return (
    <Dialog open={context !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="shortcut-sheet"
        className="sm:max-w-3xl"
        onKeyDown={(event) => {
          const toggle = bindingsOf("app.shortcuts", overrides);
          if (
            !event.repeat &&
            chordsOf(event.nativeEvent).some((c) => toggle.includes(c))
          ) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{context && TITLES[context]}</DialogTitle>
          <DialogDescription>
            Only what works here.{" "}
            <Button
              variant="link"
              data-testid="shortcut-sheet-edit"
              onClick={onEdit}
              className="h-auto p-0 text-xs"
            >
              Edit shortcuts…
            </Button>
          </DialogDescription>
        </DialogHeader>
        <div className="columns-3 gap-8">
          {GROUPS.map((group) => {
            const rows = here.filter((id) => ACTIONS[id].group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} className="mb-4 break-inside-avoid">
                <h3 className="mb-1 font-medium text-[11px] text-primary uppercase tracking-wide">
                  {group}
                </h3>
                {rows.map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between gap-2 border-border border-b py-1 text-xs"
                  >
                    <span>{ACTIONS[id].label}</span>
                    <span className="flex gap-1">
                      {bindingsOf(id, overrides).map((chord) => (
                        <Kbd key={chord}>{formatChord(chord)}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
