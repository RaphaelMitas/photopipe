import { stored, storedFlag } from "@/lib/stored";

export type RawDecoderVersion = 8 | 9;

const version = stored<RawDecoderVersion>("photopipe.rawDecoder", (raw) =>
  raw === "8" ? 8 : 9,
);
export const rawDecoderVersion = version.read;
export const setRawDecoderVersion = version.set;
export const useRawDecoderVersion = version.use;

const quickSwitch = storedFlag("photopipe.rawDecoderQuickSwitch", true);
export const setRawDecoderQuickSwitch = quickSwitch.set;
export const useRawDecoderQuickSwitch = quickSwitch.use;
