import { Segmented } from "@photopipe/ui/components/segmented";
import type { RawDecoderVersion } from "@/lib/rawDecoder";

export function DecoderSegmented({
  value,
  testid,
  raw9Disabled,
  onChange,
}: {
  value: RawDecoderVersion;
  testid: string;
  raw9Disabled?: boolean;
  onChange: (version: RawDecoderVersion) => void;
}) {
  return (
    <Segmented
      value={value === 8 ? "8" : "9"}
      options={[
        ["8", "RAW 8"],
        ["9", "RAW 9"],
      ]}
      testid={testid}
      disabled={raw9Disabled ? ["9"] : undefined}
      onChange={(next) => onChange(next === "8" ? 8 : 9)}
    />
  );
}
