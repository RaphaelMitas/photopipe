import { Button } from "@photopipe/ui/components/button";
import { Separator } from "@photopipe/ui/components/separator";
import { Slider } from "@photopipe/ui/components/slider";
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
  X,
} from "lucide-react";
import { type ReactNode, useDeferredValue, useState } from "react";
import {
  type Edit,
  type ImageFile,
  identityEdit,
  isIdentityEdit,
  isRawFile,
} from "@/lib/core";
import { isIdentityCurve } from "@/lib/curve";
import { useRawDefaults, useRender } from "@/lib/queries";
import {
  setRawDecoderVersion,
  useRawDecoderQuickSwitch,
  useRawDecoderVersion,
} from "@/lib/rawDecoder";
import { type CropDraft, CropPanel } from "./CropTool";
import { CurveEditor } from "./CurveEditor";
import { DecoderSegmented } from "./DecoderSegmented";
import { EXPOSURE_RANGE } from "./Loupe";

type CropProps = {
  cropDraft: CropDraft | null;
  onCropDraft: (draft: CropDraft) => void;
  onEnterCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
};

type Props = {
  image: ImageFile;
  edit: Edit;
  onChange: (edit: Edit) => void;
} & CropProps;

function Row({
  label,
  value,
  display,
  min,
  max,
  step,
  testid,
  resetTitle,
  trackClassName,
  onValue,
  onReset,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  testid: string;
  resetTitle: string;
  trackClassName?: string;
  onValue: (value: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="flex-1 text-right tabular-nums">{display}</span>
        <Button
          variant="ghost"
          size="icon"
          data-testid={`${testid}-reset`}
          onClick={onReset}
          title={resetTitle}
          className="size-5 text-muted-foreground"
        >
          <RotateCcw />
        </Button>
      </div>
      <Slider
        data-testid={testid}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onValue(next)}
        trackClassName={cn("data-horizontal:h-1.5", trackClassName)}
        rangeClassName="bg-transparent"
        className="**:data-[slot=slider-thumb]:h-3 **:data-[slot=slider-thumb]:w-3"
      />
    </div>
  );
}

const signed = (value: number, digits = 0) =>
  `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;

const cropSummary = (edit: Edit): string | null => {
  const parts: string[] = [];
  if (edit.rotation) parts.push(`↻${edit.rotation}°`);
  if (edit.crop) parts.push("cropped");
  if (edit.cropAngle) parts.push(`∠${edit.cropAngle.toFixed(1)}°`);
  return parts.length ? parts.join(" · ") : null;
};

const toneSummary = (edit: Edit): string | null => {
  const parts: string[] = [];
  if (edit.exposure !== 0) parts.push(`${signed(edit.exposure, 2)} ev`);
  if (edit.highlights !== 0) parts.push(`hl ${signed(edit.highlights)}`);
  if (edit.shadows !== 0) parts.push(`sh ${signed(edit.shadows)}`);
  const curves = [
    edit.curveRGB,
    edit.curveRed,
    edit.curveGreen,
    edit.curveBlue,
  ];
  if (curves.some((points) => !isIdentityCurve(points))) parts.push("curve");
  return parts.length ? parts.join(" · ") : null;
};

const colorSummary = (edit: Edit, raw: boolean): string | null => {
  const parts: string[] = [];
  if (edit.temperature != null) {
    parts.push(
      raw
        ? `${Math.round(edit.temperature)} K`
        : `temp ${signed(edit.temperature)}`,
    );
  }
  if (edit.tint != null) parts.push(`tint ${signed(edit.tint)}`);
  if (edit.vibrance !== 0) parts.push(`vib ${signed(edit.vibrance)}`);
  if (edit.saturation !== 0) parts.push(`sat ${signed(edit.saturation)}`);
  return parts.length ? parts.join(" · ") : null;
};

const detailSummary = (edit: Edit): string | null =>
  edit.denoise != null ? `dn ${Math.round(edit.denoise)}` : null;

function Group({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary?: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(
    () => localStorage.getItem(`photopipe.editGroup.${id}`) !== "closed",
  );
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        data-testid={`edit-group-${id}`}
        onClick={() => {
          localStorage.setItem(
            `photopipe.editGroup.${id}`,
            open ? "closed" : "open",
          );
          setOpen(!open);
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
        {!open && summary && (
          <span className="ml-auto overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

export function EditPanel({
  image,
  edit,
  onChange,
  cropDraft,
  onCropDraft,
  onEnterCrop,
  onApplyCrop,
  onCancelCrop,
}: Props) {
  const raw = isRawFile(image);
  const rawDefaults = useRawDefaults(raw ? image : undefined);
  // deferred like the Loupe's request, so both resolve to the same query
  const render = useRender(image, useDeferredValue(edit));

  const set = (partial: Partial<Edit>) => onChange({ ...edit, ...partial });

  const summary = cropSummary(edit);
  const asShotTemperature = rawDefaults.data?.temperature ?? 6500;
  const asShotTint = rawDefaults.data?.tint ?? 0;
  const temperature = edit.temperature ?? (raw ? asShotTemperature : 0);
  const tint = edit.tint ?? (raw ? asShotTint : 0);
  const denoise = edit.denoise ?? rawDefaults.data?.denoise ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {cropDraft ? (
        <CropPanel
          image={image}
          draft={cropDraft}
          onDraft={onCropDraft}
          onApply={onApplyCrop}
          onCancel={onCancelCrop}
        />
      ) : (
        <Group id="geometry" title="Geometry" summary={summary}>
          <Button
            variant="outline"
            size="sm"
            data-testid="enter-crop"
            onClick={onEnterCrop}
            className="justify-start text-xs"
          >
            <Crop />
            Crop & straighten
            {summary && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {summary}
              </span>
            )}
          </Button>
        </Group>
      )}
      <Separator />
      <div
        className={cn(
          "flex flex-col gap-3",
          cropDraft && "pointer-events-none opacity-40",
        )}
      >
        <Group id="tone" title="Tone" summary={toneSummary(edit)}>
          <CurveEditor edit={edit} imageSrc={render.data} onChange={set} />
          <Row
            label="Exposure"
            value={edit.exposure}
            display={signed(edit.exposure, 2)}
            min={-EXPOSURE_RANGE}
            max={EXPOSURE_RANGE}
            step={0.05}
            testid="exposure"
            resetTitle="Reset exposure (r)"
            onValue={(exposure) => set({ exposure })}
            onReset={() => set({ exposure: 0 })}
          />
          <Row
            label="Highlights"
            value={edit.highlights}
            display={signed(edit.highlights)}
            min={-100}
            max={100}
            step={1}
            testid="highlights"
            resetTitle="Reset highlights"
            onValue={(highlights) => set({ highlights })}
            onReset={() => set({ highlights: 0 })}
          />
          <Row
            label="Shadows"
            value={edit.shadows}
            display={signed(edit.shadows)}
            min={-100}
            max={100}
            step={1}
            testid="shadows"
            resetTitle="Reset shadows"
            onValue={(shadows) => set({ shadows })}
            onReset={() => set({ shadows: 0 })}
          />
        </Group>
        <Separator />
        <Group id="color" title="Color" summary={colorSummary(edit, raw)}>
          {raw ? (
            <Row
              label="Temp"
              value={temperature}
              display={`${Math.round(temperature)} K`}
              min={2000}
              max={12000}
              step={50}
              testid="temperature"
              resetTitle="Reset to as shot"
              trackClassName="bg-gradient-to-r from-sky-500/70 via-white/20 to-amber-400/80"
              onValue={(value) => set({ temperature: value })}
              onReset={() => set({ temperature: null })}
            />
          ) : (
            <Row
              label="Temp"
              value={temperature}
              display={signed(temperature)}
              min={-100}
              max={100}
              step={1}
              testid="temperature"
              resetTitle="Reset temperature"
              trackClassName="bg-gradient-to-r from-sky-500/70 via-white/20 to-amber-400/80"
              onValue={(value) =>
                set({ temperature: value === 0 ? null : value })
              }
              onReset={() => set({ temperature: null })}
            />
          )}
          <Row
            label="Tint"
            value={tint}
            display={signed(tint)}
            min={raw ? -150 : -100}
            max={raw ? 150 : 100}
            step={1}
            testid="tint"
            resetTitle={raw ? "Reset to as shot" : "Reset tint"}
            trackClassName="bg-gradient-to-r from-green-500/70 via-white/20 to-fuchsia-500/70"
            onValue={(value) =>
              set({ tint: !raw && value === 0 ? null : value })
            }
            onReset={() => set({ tint: null })}
          />
          <Row
            label="Vibrance"
            value={edit.vibrance}
            display={signed(edit.vibrance)}
            min={-100}
            max={100}
            step={1}
            testid="vibrance"
            resetTitle="Reset vibrance"
            trackClassName="bg-gradient-to-r from-zinc-500/60 to-teal-400/70"
            onValue={(vibrance) => set({ vibrance })}
            onReset={() => set({ vibrance: 0 })}
          />
          <Row
            label="Saturation"
            value={edit.saturation}
            display={signed(edit.saturation)}
            min={-100}
            max={100}
            step={1}
            testid="saturation"
            resetTitle="Reset saturation"
            trackClassName="bg-gradient-to-r from-zinc-500/60 to-orange-400/70"
            onValue={(saturation) => set({ saturation })}
            onReset={() => set({ saturation: 0 })}
          />
        </Group>
        {raw && (
          <>
            <Separator />
            <Group id="detail" title="Detail" summary={detailSummary(edit)}>
              <Row
                label="Denoise"
                value={denoise}
                display={`${Math.round(denoise)}`}
                min={0}
                max={100}
                step={1}
                testid="denoise"
                resetTitle="Reset to as decoded"
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
  const version = useRawDecoderVersion();
  // Radix opens on hover only, and the icon is small enough to want a tap
  const [tipOpen, setTipOpen] = useState(false);
  return (
    <div
      data-testid="decoder-strip"
      className="flex shrink-0 items-center gap-2 border-border border-t bg-foreground/3 px-3 py-2"
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-input px-2.5 py-1 font-medium text-[10px] text-muted-foreground">
        RAW decoder
        <Tooltip open={tipOpen} onOpenChange={setTipOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About the RAW decoder"
              data-testid="decoder-info"
              onPointerDown={(event) => {
                // Radix closes the tooltip on pointerdown, so a plain click
                // handler only ever reopens it; preventDefault drops their
                // handler and leaves the toggle to us.
                event.preventDefault();
                setTipOpen((open) => !open);
              }}
              className="hover:text-foreground"
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
      <div className="ml-auto w-34">
        <DecoderSegmented
          value={version}
          testid="decoder-quick"
          onChange={setRawDecoderVersion}
        />
      </div>
    </div>
  );
}

export function EditSidebar({
  image,
  edit,
  onChange,
  cropDraft,
  onCropDraft,
  onEnterCrop,
  onApplyCrop,
  onCancelCrop,
  canPaste,
  onCopySettings,
  onPasteSettings,
  onClose,
}: Props & {
  canPaste: boolean;
  onCopySettings: () => void;
  onPasteSettings: () => void;
  onClose: () => void;
}) {
  const cropping = cropDraft !== null;
  const quickSwitch = useRawDecoderQuickSwitch();
  return (
    <div
      data-testid="edit-sidebar"
      className="flex w-64 shrink-0 flex-col border-border border-l bg-sidebar"
    >
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <span className="font-medium text-sm">Edit</span>
        <Button
          variant="ghost"
          size="icon"
          data-testid="edit-copy-settings"
          onClick={onCopySettings}
          disabled={cropping}
          title="Copy settings (⌘C)"
          className="ml-auto size-6 text-muted-foreground"
        >
          <Copy className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="edit-paste-settings"
          onClick={onPasteSettings}
          disabled={cropping || !canPaste}
          title={
            canPaste
              ? "Paste settings (⌘V)"
              : "Copy settings from a photo first"
          }
          className="size-6 text-muted-foreground"
        >
          <ClipboardPaste className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="edit-reset-all"
          onClick={() => onChange({ ...identityEdit })}
          disabled={isIdentityEdit(edit) || cropping}
          title="Reset all edits"
          className="h-6 px-1.5 text-[10px] text-muted-foreground"
        >
          <RotateCcw className="size-3" />
          Reset all
        </Button>
        <Button
          variant="ghost"
          size="icon"
          data-testid="edit-close"
          onClick={onClose}
          disabled={cropping}
          title={cropping ? "Finish the crop first" : "Hide edit panel (e)"}
          className="size-6 text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {image.enriched ? (
          <EditPanel
            image={image}
            edit={edit}
            onChange={onChange}
            cropDraft={cropDraft}
            onCropDraft={onCropDraft}
            onEnterCrop={onEnterCrop}
            onApplyCrop={onApplyCrop}
            onCancelCrop={onCancelCrop}
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
      {quickSwitch && isRawFile(image) && <DecoderStrip />}
    </div>
  );
}
