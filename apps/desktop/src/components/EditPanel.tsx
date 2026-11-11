import { Button } from "@photopipe/ui/components/button";
import { Separator } from "@photopipe/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@photopipe/ui/components/tooltip";
import { cn } from "@photopipe/ui/lib/utils";
import {
  ChevronDown,
  ClipboardPaste,
  Copy,
  Crop,
  Info,
  RotateCcw,
  SquareSplitHorizontal,
  X,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  type Edit,
  type ImageFile,
  identityEdit,
  isIdentityEdit,
  type LocalAdjust,
  maskName,
} from "@/lib/core";
import { CURVE_CHANNELS, isIdentityCurve } from "@/lib/curve";
import {
  COLOR_SLIDERS,
  EXPOSURE_RANGE,
  kelvin,
  PRESENCE_SLIDERS,
  type SliderSpec,
  signed,
  TONE_SLIDERS,
} from "@/lib/editSliders";
import { flagPref } from "@/lib/pref";
import {
  useDeferredEdit,
  useRaw9Availability,
  useRawDefaults,
  useRender,
} from "@/lib/queries";
import {
  setRawDecoderVersion,
  useRawDecoderQuickSwitch,
  useRawDecoderVersion,
} from "@/lib/rawDecoder";
import type { CropSession } from "@/lib/useCropSession";
import type { MaskSession } from "@/lib/useMaskSession";
import { CropPanel } from "./CropTool";
import { CurveEditor } from "./CurveEditor";
import { DecoderSegmented } from "./DecoderSegmented";
import { MaskList } from "./MaskList";
import { ShortcutTooltip } from "./ShortcutTooltip";
import { SliderRow } from "./SliderRow";

type Props = {
  image: ImageFile;
  edit: Edit;
  onChange: (edit: Edit) => void;
  crop: CropSession;
  masks: MaskSession;
};

function SliderRows<Key extends SliderSpec["key"]>({
  sliders,
  values,
  onValue,
}: {
  sliders: SliderSpec<Key>[];
  values: Record<Key, number>;
  onValue: (key: Key, value: number) => void;
}) {
  return sliders.map(({ key, label, trackClassName }) => (
    <SliderRow
      key={key}
      label={label}
      value={values[key]}
      display={signed(values[key])}
      min={-100}
      max={100}
      step={1}
      testid={key}
      resetLabel={`Reset ${label.toLowerCase()}`}
      trackClassName={trackClassName}
      onValue={(value) => onValue(key, value)}
      onReset={() => onValue(key, 0)}
    />
  ));
}

const sliderSummary = (edit: Edit, sliders: SliderSpec[]): string[] =>
  sliders
    .filter(({ key }) => edit[key] !== 0)
    .map(({ key, short }) => `${short} ${signed(edit[key])}`);

const joined = (parts: string[]): string | null =>
  parts.length ? parts.join(" · ") : null;

const cropSummary = (edit: Edit): string | null => {
  const parts: string[] = [];
  if (edit.rotation) parts.push(`↻${edit.rotation}°`);
  if (edit.crop) parts.push("cropped");
  if (edit.cropAngle) parts.push(`∠${edit.cropAngle.toFixed(1)}°`);
  return joined(parts);
};

const toneSummary = (edit: Edit): string | null => {
  const parts: string[] = [];
  if (edit.exposure !== 0) parts.push(`${signed(edit.exposure, 2)} ev`);
  parts.push(...sliderSummary(edit, TONE_SLIDERS));
  if (CURVE_CHANNELS.some(({ key }) => !isIdentityCurve(edit[key])))
    parts.push("curve");
  return joined(parts);
};

const colorSummary = (edit: Edit, raw: boolean): string | null => {
  const parts: string[] = [];
  if (edit.temperature != null) {
    parts.push(
      raw ? kelvin(edit.temperature) : `temp ${signed(edit.temperature)}`,
    );
  }
  if (edit.tint != null) parts.push(`tint ${signed(edit.tint)}`);
  parts.push(...sliderSummary(edit, COLOR_SLIDERS));
  return joined(parts);
};

const detailSummary = (edit: Edit): string | null =>
  edit.denoise != null ? `dn ${Math.round(edit.denoise)}` : null;

const groupPrefs = new Map<string, ReturnType<typeof flagPref>>();

export function editGroupPref(id: string) {
  const known = groupPrefs.get(id);
  if (known) return known;
  const pref = flagPref(`photopipe.editGroup.${id}`, "open", "closed", true);
  groupPrefs.set(id, pref);
  return pref;
}

function Group({
  id,
  title,
  summary,
  badge,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary?: string | null;
  badge?: ReactNode;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const pref = editGroupPref(id);
  const open = pref.use();
  const aside = badge ?? (!open && summary);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        data-testid={`edit-group-${id}`}
        onClick={() => {
          pref.toggle();
          onToggle?.();
        }}
        className="flex w-full items-center gap-1.5 text-left font-medium text-xs"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
        {title}
        {aside && (
          <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap font-mono text-2xs text-muted-foreground">
            {aside}
          </span>
        )}
      </button>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function EditPanel({ image, edit, onChange, crop, masks }: Props) {
  const raw = image.isRaw;
  const rawDefaults = useRawDefaults(raw ? image : undefined);
  // deferred like the Loupe's request, so both resolve to the same query
  const render = useRender(image, useDeferredEdit(image, edit));

  const set = (partial: Partial<Edit>) => onChange({ ...edit, ...partial });

  const target = masks.target;
  const targetBadge = target && (
    <span className="text-mask-foreground">{maskName(target)}</span>
  );
  const values = target?.adjust ?? edit;
  const adjust = (partial: Partial<LocalAdjust>) =>
    target ? masks.adjust(partial) : set(partial);
  const kelvinScale = raw && !target;
  const setTemperature = (value: number | null) =>
    target
      ? masks.adjust({ temperature: value ?? 0 })
      : set({ temperature: value });
  const setTint = (value: number | null) =>
    target ? masks.adjust({ tint: value ?? 0 }) : set({ tint: value });

  const summary = cropSummary(edit);
  const asShotTemperature = rawDefaults.data?.temperature ?? 6500;
  const asShotTint = rawDefaults.data?.tint ?? 0;
  const temperature = target
    ? target.adjust.temperature
    : (edit.temperature ?? (raw ? asShotTemperature : 0));
  const tint = target
    ? target.adjust.tint
    : (edit.tint ?? (raw ? asShotTint : 0));
  const denoise = edit.denoise ?? rawDefaults.data?.denoise ?? 0;
  const whileCropping = crop.draft && "pointer-events-none opacity-40";

  return (
    <div className="flex flex-col gap-3">
      <div className={cn(whileCropping)}>
        <Group
          id="masks"
          title="Masks"
          badge={edit.masks.length || null}
          onToggle={masks.cancel}
        >
          <MaskList image={image} edit={edit} masks={masks} />
        </Group>
      </div>
      <Separator />
      {!target && (
        <>
          {crop.draft ? (
            <CropPanel
              image={image}
              draft={crop.draft}
              onDraft={crop.set}
              onApply={crop.apply}
              onCancel={crop.cancel}
            />
          ) : (
            <Group id="geometry" title="Geometry" summary={summary}>
              <Button
                variant="outline"
                size="sm"
                data-testid="enter-crop"
                onClick={crop.enter}
                className="justify-start text-xs"
              >
                <Crop />
                Crop & straighten
                {summary && (
                  <span className="ml-auto min-w-0 truncate font-mono text-2xs text-muted-foreground">
                    {summary}
                  </span>
                )}
              </Button>
            </Group>
          )}
          <Separator />
        </>
      )}
      <div className={cn("flex flex-col gap-3", whileCropping)}>
        <Group
          id="tone"
          title="Tone"
          summary={toneSummary(edit)}
          badge={targetBadge}
        >
          {!target && (
            <CurveEditor
              edit={edit}
              imageSrc={render.data}
              photo={image.path}
              onChange={set}
            />
          )}
          <SliderRow
            label="Exposure"
            value={values.exposure}
            display={signed(values.exposure, 2)}
            min={-EXPOSURE_RANGE}
            max={EXPOSURE_RANGE}
            step={0.05}
            testid="exposure"
            resetLabel="Reset exposure"
            resetAction="exposure.reset"
            onValue={(exposure) => adjust({ exposure })}
            onReset={() => adjust({ exposure: 0 })}
          />
          <SliderRows
            sliders={TONE_SLIDERS}
            values={values}
            onValue={(key, value) => adjust({ [key]: value })}
          />
        </Group>
        <Separator />
        {!target && (
          <>
            <Group
              id="presence"
              title="Presence"
              summary={joined(sliderSummary(edit, PRESENCE_SLIDERS))}
            >
              <SliderRows
                sliders={PRESENCE_SLIDERS}
                values={edit}
                onValue={(key, value) => set({ [key]: value })}
              />
            </Group>
            <Separator />
          </>
        )}
        <Group
          id="color"
          title="Color"
          summary={colorSummary(edit, raw)}
          badge={targetBadge}
        >
          {kelvinScale ? (
            <SliderRow
              label="Temp"
              value={temperature}
              display={kelvin(temperature)}
              min={2000}
              max={12000}
              step={50}
              testid="temperature"
              resetLabel="Reset to as shot"
              trackClassName="bg-gradient-to-r from-sky-500/70 via-white/20 to-amber-400/80"
              onValue={setTemperature}
              onReset={() => setTemperature(null)}
            />
          ) : (
            <SliderRow
              label="Temp"
              value={temperature}
              display={signed(temperature)}
              min={-100}
              max={100}
              step={1}
              testid="temperature"
              resetLabel="Reset temperature"
              trackClassName="bg-gradient-to-r from-sky-500/70 via-white/20 to-amber-400/80"
              onValue={(value) => setTemperature(value === 0 ? null : value)}
              onReset={() => setTemperature(null)}
            />
          )}
          <SliderRow
            label="Tint"
            value={tint}
            display={signed(tint)}
            min={kelvinScale ? -150 : -100}
            max={kelvinScale ? 150 : 100}
            step={1}
            testid="tint"
            resetLabel={kelvinScale ? "Reset to as shot" : "Reset tint"}
            trackClassName="bg-gradient-to-r from-green-500/70 via-white/20 to-fuchsia-500/70"
            onValue={(value) =>
              setTint(!kelvinScale && value === 0 ? null : value)
            }
            onReset={() => setTint(null)}
          />
          <SliderRows
            sliders={COLOR_SLIDERS}
            values={values}
            onValue={(key, value) => adjust({ [key]: value })}
          />
        </Group>
        {target && (
          <p className="text-2xs text-muted-foreground">
            Crop, curves and denoise stay with the photo.
          </p>
        )}
        {raw && !target && (
          <>
            <Separator />
            <Group id="detail" title="Detail" summary={detailSummary(edit)}>
              <SliderRow
                label="Denoise"
                value={denoise}
                display={`${Math.round(denoise)}`}
                min={0}
                max={100}
                step={1}
                testid="denoise"
                resetLabel="Reset to as decoded"
                trackClassName="bg-gradient-to-r from-zinc-500/60 to-sky-400/70"
                onValue={(value) => set({ denoise: value })}
                onReset={() => set({ denoise: null })}
              />
            </Group>
          </>
        )}
      </div>
    </div>
  );
}

function DecoderStrip() {
  const stored = useRawDecoderVersion();
  const raw9Missing = useRaw9Availability(true).data === false;
  const version = raw9Missing ? 8 : stored;
  // Radix opens on hover only, and the icon is small enough to want a tap
  const [tipOpen, setTipOpen] = useState(false);
  // Mirrors tipOpen so pointerdown reads the live value, not a render
  // closure; Radix fires open/close between our renders and a stale
  // snapshot made the closing click reopen the tip (flaked in CI).
  const openRef = useRef(false);
  const intentRef = useRef<"open" | "close">("open");
  const setOpen = (next: boolean) => {
    openRef.current = next;
    setTipOpen(next);
  };
  return (
    <div
      data-testid="decoder-strip"
      className="flex shrink-0 items-center gap-2 border-border border-t bg-foreground/3 px-3 py-2"
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-muted-foreground text-xs">
        RAW decoder
        <Tooltip open={tipOpen} onOpenChange={setOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About the RAW decoder"
              data-testid="decoder-info"
              // Radix closes the tooltip on pointerdown and again on click,
              // both before ours run, so a relative toggle only ever reopens.
              // Decide the intent before Radix interferes, enforce it last.
              onPointerDown={() => {
                intentRef.current = openRef.current ? "close" : "open";
              }}
              onClick={(event) => {
                event.preventDefault();
                setOpen(intentRef.current === "open");
              }}
              className="relative finger-target hover:text-foreground"
            >
              <Info className="size-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-56">
            <span>
              {version === 9
                ? "Newest pipeline, strongest denoising."
                : "Fast decode, solid quality."}{" "}
              Applies to every photo, like in Settings.
              <span className="block text-background/70">
                You can hide this switch in Settings.
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </span>
      <div className="ml-auto w-32">
        <DecoderSegmented
          value={version}
          testid="decoder-quick"
          raw9Disabled={raw9Missing}
          onChange={(next) => {
            if (next !== version) setRawDecoderVersion(next);
          }}
        />
      </div>
    </div>
  );
}

export function EditSidebar({
  image,
  edit,
  onChange,
  onHold,
  crop,
  split,
  onToggleSplit,
  canPaste,
  onCopySettings,
  onPasteSettings,
  onClose,
  masks,
}: Props & {
  onHold: () => void;
  split: boolean;
  onToggleSplit: () => void;
  canPaste: boolean;
  onCopySettings: () => void;
  onPasteSettings: () => void;
  onClose: () => void;
}) {
  const cropping = crop.draft !== null;
  const quickSwitch = useRawDecoderQuickSwitch();
  return (
    <div
      data-testid="edit-sidebar"
      onPointerDownCapture={(event) => event.button === 0 && onHold()}
      className="flex w-64 shrink-0 flex-col border-border border-l bg-sidebar"
    >
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <span className="font-medium text-sm">Edit</span>
        <ShortcutTooltip label="Compare before and after" action="split.toggle">
          <Button
            variant={split ? "secondary" : "ghost"}
            size="icon"
            data-testid="edit-split"
            aria-label="Compare before and after"
            aria-pressed={split}
            onClick={onToggleSplit}
            disabled={cropping}
            className="ml-auto size-6 text-muted-foreground"
          >
            <SquareSplitHorizontal className="size-3" />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Copy settings" action="settings.copy">
          <Button
            variant="ghost"
            size="icon"
            data-testid="edit-copy-settings"
            aria-label="Copy settings"
            onClick={onCopySettings}
            disabled={cropping}
            className="size-6 text-muted-foreground"
          >
            <Copy className="size-3" />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Paste settings" action="settings.paste">
          <Button
            variant="ghost"
            size="icon"
            data-testid="edit-paste-settings"
            aria-label="Paste settings"
            onClick={onPasteSettings}
            disabled={cropping || !canPaste}
            className="size-6 text-muted-foreground"
          >
            <ClipboardPaste className="size-3" />
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Reset all edits">
          <Button
            variant="ghost"
            size="sm"
            data-testid="edit-reset-all"
            onClick={() => onChange({ ...identityEdit })}
            disabled={isIdentityEdit(edit) || cropping}
            className="h-6 px-1.5 text-2xs text-muted-foreground"
          >
            <RotateCcw className="size-3" />
            Reset all
          </Button>
        </ShortcutTooltip>
        <ShortcutTooltip label="Hide edit panel" action="editPanel.toggle">
          <Button
            variant="ghost"
            size="icon"
            data-testid="edit-close"
            aria-label="Hide edit panel"
            onClick={onClose}
            disabled={cropping}
            className="size-6 text-muted-foreground"
          >
            <X />
          </Button>
        </ShortcutTooltip>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {image.enriched ? (
          <EditPanel
            image={image}
            edit={edit}
            onChange={onChange}
            crop={crop}
            masks={masks}
          />
        ) : (
          <p
            data-testid="edit-not-indexed"
            className="text-muted-foreground text-xs"
          >
            Reading this photo's existing edits…
          </p>
        )}
      </div>
      {quickSwitch && image.isRaw && <DecoderStrip />}
    </div>
  );
}
