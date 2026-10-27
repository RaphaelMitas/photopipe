import type { ExportFormat, ImageFile } from "./core";
import { fileName } from "./fileName";
import { takenAt } from "./sort";

export const NAME_TOKENS = [
  "date",
  "time",
  "seq",
  "original",
  "rating",
  "shoot",
] as const;
type NameToken = (typeof NAME_TOKENS)[number];

export const NAME_PRESETS = [
  { label: "Date · shoot · number", template: "{date}_{shoot}_{seq}" },
  { label: "Date · time · original", template: "{date}_{time}_{original}" },
  { label: "Number · original", template: "{seq}_{original}" },
  { label: "Shoot · number", template: "{shoot}_{seq}" },
] as const;

export const DEFAULT_TEMPLATE = NAME_PRESETS[0].template;

const TOKEN = /\{([^{}]*)\}/g;
// leaves room for a collision suffix and the extension under the 255-byte limit
const MAX_STEM_BYTES = 200;
const utf8 = new TextEncoder();

const isNameToken = (value: string): value is NameToken =>
  NAME_TOKENS.some((token) => token === value);

/// Only what the user typed blocks an export; values a photo brings are cleaned instead.
export function templateProblem(template: string): string | null {
  if (template.trim() === "") return "Type a name or pick a preset.";
  const unknown = [...template.matchAll(TOKEN)].find(
    ([, token]) => !isNameToken(token),
  );
  if (unknown) return `${unknown[0]} isn't a token.`;
  if (/[/:]/.test(template)) return "Names can't contain / or :.";
  return null;
}

export type TemplatePart = { text: string; kind: "text" | "token" | "unknown" };

export function templateParts(template: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    if (match.index > last)
      parts.push({ text: template.slice(last, match.index), kind: "text" });
    parts.push({
      text: match[0],
      kind: isNameToken(match[1]) ? "token" : "unknown",
    });
    last = match.index + match[0].length;
  }
  if (last < template.length)
    parts.push({ text: template.slice(last), kind: "text" });
  return parts;
}

export const usesCaptureTime = (template: string) =>
  /\{(date|time)\}/.test(template);

export const stem = (image: ImageFile) =>
  fileName(image.rel).replace(/\.[^.]*$/, "");

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function tokenValue(
  token: NameToken,
  image: ImageFile,
  index: number,
  count: number,
  shoot: string,
): string {
  // takenAt is the camera's wall clock expressed as UTC, so read it back as UTC
  const taken = new Date(takenAt(image) * 1000);
  switch (token) {
    case "date":
      return `${taken.getUTCFullYear()}-${pad(taken.getUTCMonth() + 1)}-${pad(taken.getUTCDate())}`;
    case "time":
      return `${pad(taken.getUTCHours())}${pad(taken.getUTCMinutes())}${pad(taken.getUTCSeconds())}`;
    case "seq":
      return pad(index + 1, Math.max(3, String(count).length));
    case "original":
      return stem(image);
    case "rating":
      return String(image.rating);
    case "shoot":
      return shoot;
  }
}

function clean(name: string): string {
  let out = "";
  let bytes = 0;
  for (const char of name.replace(/[/:]/g, "-")) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    bytes += utf8.encode(char).length;
    if (bytes > MAX_STEM_BYTES) break;
    out += char;
  }
  return out.replace(/^[\s.]+/, "").trimEnd();
}

/// The file name without its extension; the core adds the extension and the
/// -1/-2 suffixes when two names meet.
export function exportName(
  template: string,
  image: ImageFile,
  index: number,
  count: number,
  shoot: string,
): string {
  const name = clean(
    template.replace(TOKEN, (match, token: string) =>
      isNameToken(token)
        ? tokenValue(token, image, index, count, shoot)
        : match,
    ),
  );
  return name === "" ? stem(image) : name;
}

/// Where the core will put `name`, before any -1/-2 suffix.
export function exportPath(
  image: ImageFile,
  name: string,
  format: ExportFormat,
  flatten: boolean,
): string {
  const ext =
    format === "jpeg" ? "jpg" : (/\.([^./]*)$/.exec(image.rel)?.[1] ?? "");
  const dir = flatten ? "" : image.rel.slice(0, image.rel.lastIndexOf("/") + 1);
  return `${dir}${name}${ext ? `.${ext}` : ""}`;
}
