import { Crop, RotateCcw, X } from "lucide-react";
import { useDeferredValue } from "react";
import {
  type Edit,
  type ImageFile,
  identityEdit,
  isIdentityEdit,
  isRawFile,
} from "@/lib/core";
import { useRender, useWhiteBalance } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { type CropDraft, CropPanel } from "./CropTool";
import { CurveEditor } from "./CurveEditor";
import { EXPOSURE_RANGE } from "./Loupe";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Slider } from "./ui/slider";

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
  const whiteBalance = useWhiteBalance(raw ? image : undefined);
  // Deferred like the Loupe's own render request, so both resolve to the same
  // query and dragging never fans out into extra renders.
  const render = useRender(image, useDeferredValue(edit));

  const set = (partial: Partial<Edit>) => onChange({ ...edit, ...partial });

  const summary = cropSummary(edit);
  const asShotTemperature = whiteBalance.data?.temperature ?? 6500;
  const asShotTint = whiteBalance.data?.tint ?? 0;
  const temperature = edit.temperature ?? (raw ? asShotTemperature : 0);
  const tint = edit.tint ?? (raw ? asShotTint : 0);

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
      )}
      <Separator />
      <div
        className={cn(
          "flex flex-col gap-3",
          cropDraft && "pointer-events-none opacity-40",
        )}
      >
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
          onValue={(value) => set({ tint: !raw && value === 0 ? null : value })}
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
  onClose,
}: Props & { onClose: () => void }) {
  const cropping = cropDraft !== null;
  return (
    <div
      data-testid="edit-sidebar"
      className="flex w-64 shrink-0 flex-col overflow-y-auto border-border border-l bg-sidebar"
    >
      <div className="flex items-center gap-1 border-border border-b px-3 py-2">
        <span className="font-medium text-sm">Edit</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="edit-reset-all"
          onClick={() => onChange({ ...identityEdit })}
          disabled={isIdentityEdit(edit) || cropping}
          title="Reset all edits"
          className="ml-auto h-6 px-1.5 text-[10px] text-muted-foreground"
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
      <div className="p-3">
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
      </div>
    </div>
  );
}
