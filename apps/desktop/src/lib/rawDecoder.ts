import { pref } from "./pref";

export type RawDecoderVersion = 8 | 9;

export const {
  get: rawDecoderVersion,
  set: setRawDecoderVersion,
  use: useRawDecoderVersion,
} = pref<RawDecoderVersion>(
  "photopipe.rawDecoder",
  (raw) => (raw === "8" ? 8 : 9),
  String,
);

export const { set: setRawDecoderQuickSwitch, use: useRawDecoderQuickSwitch } =
  pref(
    "photopipe.rawDecoderQuickSwitch",
    (raw) => raw !== "off",
    (on) => (on ? "on" : "off"),
  );
