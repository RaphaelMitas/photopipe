import { Button } from "@photopipe/ui/components/button";
import { Kbd } from "@photopipe/ui/components/kbd";
import { cn } from "@photopipe/ui/lib/utils";
import { Contrast, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import {
  type Edit,
  fileSrc,
  type ImageFile,
  type Mask,
  type MaskShape,
  maskName,
} from "@/lib/core";
import { useMaskOverlay, useMaskSupport } from "@/lib/queries";
import { useShortcutLabel } from "@/lib/shortcuts";
import type { MaskSession } from "@/lib/useMaskSession";
import { ShortcutTooltip } from "./ShortcutTooltip";

const CHIPS: MaskShape[] = [
  { source: "subject", inverted: false, points: [] },
  { source: "people", inverted: false, points: [] },
  { source: "subject", inverted: true, points: [] },
];

const reveal = (field: HTMLElement | null) =>
  field?.scrollIntoView({ block: "nearest" });

const THUMB = "size-6 shrink-0 overflow-hidden rounded-xs border border-border";

type Props = { image: ImageFile; edit: Edit; masks: MaskSession };

export function MaskList({ image, edit, masks }: Props) {
  const addKey = useShortcutLabel("mask.add");
  const clickable = (useMaskSupport().data?.clicks ?? 0) > 0;
  return (
    <div className="flex flex-col gap-0.5">
      {edit.masks.length > 0 && (
        <>
          <Row
            testid="mask-row-photo"
            selected={masks.target === null}
            onSelect={() => masks.select(null)}
            thumb={<span className={cn(THUMB, "bg-zinc-300")} />}
            name="Photo"
          />
          {edit.masks.map((mask) => (
            <MaskRow
              key={mask.id}
              image={image}
              edit={edit}
              mask={mask}
              masks={masks}
            />
          ))}
        </>
      )}
      {masks.creating ? (
        <div
          ref={reveal}
          data-testid="mask-field"
          className="mt-1 flex flex-col gap-1.5"
        >
          <div className="flex flex-wrap gap-1">
            {CHIPS.map((shape) => (
              <button
                key={maskName(shape)}
                type="button"
                data-testid={`mask-chip-${maskName(shape).toLowerCase()}`}
                onPointerEnter={() => masks.hoverChip(shape)}
                onPointerLeave={() => masks.hoverChip(null)}
                onClick={() => masks.add(shape)}
                className="rounded-full border border-border bg-muted px-2 py-0.5 pointer-coarse:px-3 pointer-coarse:py-1.5 text-xs hover:border-primary"
              >
                {maskName(shape)}
              </button>
            ))}
          </div>
          <p className="flex items-center text-2xs text-muted-foreground">
            {clickable ? "Pick one, or click the photo" : "Pick what to mask"}
            <button
              type="button"
              aria-label="Cancel"
              onClick={masks.cancel}
              className="relative finger-target ml-auto"
            >
              <Kbd>esc</Kbd>
            </button>
          </p>
        </div>
      ) : (
        <button
          type="button"
          data-testid="mask-add"
          onClick={masks.toggleField}
          className="mt-1 flex w-full items-center gap-1.5 rounded-md border border-border border-dashed px-2 py-1 pointer-coarse:py-2 text-muted-foreground text-xs hover:border-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" />
          Mask
          {addKey && <Kbd className="ml-auto">{addKey}</Kbd>}
        </button>
      )}
    </div>
  );
}

function Row({
  testid,
  selected,
  dimmed = false,
  onSelect,
  onHover,
  thumb,
  name,
  children,
}: {
  testid: string;
  selected: boolean;
  dimmed?: boolean;
  onSelect: () => void;
  onHover?: (over: boolean) => void;
  thumb: ReactNode;
  name: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      data-selected={selected}
      onPointerEnter={onHover && (() => onHover(true))}
      onPointerLeave={onHover && (() => onHover(false))}
      className={cn(
        "group flex items-center rounded-md border-transparent border-l-2 pr-1 text-xs hover:bg-foreground/5",
        selected && "border-primary bg-muted hover:bg-muted",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-1 pointer-coarse:py-2 pl-1.5 text-left",
          dimmed && "opacity-40",
        )}
      >
        {thumb}
        <span className="truncate">{name}</span>
      </button>
      {children && (
        <span
          className={cn(
            "hidden group-focus-within:inline-flex group-hover:inline-flex",
            selected && "inline-flex",
          )}
        >
          {children}
        </span>
      )}
    </div>
  );
}

function MaskRow({ image, edit, mask, masks }: Props & { mask: Mask }) {
  const matte = useMaskOverlay(image, mask, edit).data;
  const name = maskName(mask);
  return (
    <Row
      testid={`mask-row-${mask.id}`}
      selected={masks.target?.id === mask.id}
      dimmed={mask.hidden}
      onSelect={() => masks.select(mask.id)}
      onHover={(over) => masks.hoverRow(over ? mask.id : null)}
      thumb={
        <span className={cn(THUMB, "bg-black")}>
          {matte && (
            <span
              className="mask-contain mask-center mask-no-repeat block size-full bg-white"
              style={{ maskImage: `url("${fileSrc(matte)}")` }}
            />
          )}
        </span>
      }
      name={name}
    >
      <Action
        label={mask.hidden ? `Show ${name}` : `Hide ${name}`}
        testid="mask-hide"
        active={mask.hidden}
        onClick={() => masks.toggleHidden(mask)}
      >
        {mask.hidden ? <EyeOff /> : <Eye />}
      </Action>
      <Action
        label={`Invert ${name}`}
        testid="mask-invert"
        onClick={() => masks.invert(mask)}
      >
        <Contrast />
      </Action>
      <Action
        label={`Delete ${name}`}
        testid="mask-delete"
        onClick={() => masks.remove(mask)}
      >
        <Trash2 />
      </Action>
    </Row>
  );
}

function Action({
  label,
  testid,
  active,
  onClick,
  children,
}: {
  label: string;
  testid: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <ShortcutTooltip label={label}>
      <Button
        variant="ghost"
        size="icon"
        data-testid={testid}
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "size-5 pointer-coarse:size-9 text-muted-foreground [&_svg]:size-3 pointer-coarse:[&_svg]:size-4",
          active && "text-primary",
        )}
      >
        {children}
      </Button>
    </ShortcutTooltip>
  );
}
