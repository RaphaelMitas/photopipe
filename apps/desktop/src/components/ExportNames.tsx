import { Button } from "@photopipe/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@photopipe/ui/components/dropdown-menu";
import { Input } from "@photopipe/ui/components/input";
import { cn } from "@photopipe/ui/lib/utils";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { useRef } from "react";
import type { ExportFormat, ImageFile } from "@/lib/core";
import {
  exportName,
  exportPath,
  NAME_PRESETS,
  NAME_TOKENS,
  stem,
  TEMPLATE_LIMIT,
  templateParts,
  templateProblem,
  usesToken,
} from "@/lib/exportNames";
import { pluralize } from "@/lib/plural";
import { SORT_LABELS, type SortKey } from "@/lib/sort";

const PREVIEW_COUNT = 3;

type Props = {
  template: string;
  recent: string[];
  names: string[];
  images: ImageFile[];
  shoot: string;
  sort: SortKey;
  format: ExportFormat;
  flatten: boolean;
  onChange: (template: string) => void;
};

function PresetMenu({
  template,
  recent,
  images,
  shoot,
  onChange,
}: Pick<Props, "template" | "recent" | "images" | "shoot" | "onChange">) {
  const sample = images[0];
  const mark = (value: string) =>
    value === template && <Check className="ml-auto size-3.5 text-primary" />;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="ghost"
          data-testid="name-presets"
          className="absolute inset-y-1 right-1 h-auto rounded-full text-[11px] text-muted-foreground"
        >
          Presets
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {recent.length > 0 && (
          <>
            <DropdownMenuLabel className="py-1.5 text-[10px] uppercase tracking-wider">
              Recent
            </DropdownMenuLabel>
            {recent.map((used) => (
              <DropdownMenuItem
                key={used}
                data-testid="name-recent"
                onSelect={() => onChange(used)}
                className="font-mono text-xs"
              >
                <span className="truncate">{used}</span>
                {mark(used)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="py-1.5 text-[10px] uppercase tracking-wider">
              Presets
            </DropdownMenuLabel>
          </>
        )}
        {NAME_PRESETS.map((preset) => (
          <DropdownMenuItem
            key={preset.template}
            data-testid="name-preset"
            onSelect={() => onChange(preset.template)}
            className="flex-col items-stretch gap-0.5 text-xs"
          >
            <span className="flex items-center">
              {preset.label}
              {mark(preset.template)}
            </span>
            {sample && (
              <span className="truncate font-mono text-[10px] text-muted-foreground">
                {exportName(preset.template, sample, 0, images.length, shoot)}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ExportNames({
  template,
  recent,
  names,
  images,
  shoot,
  sort,
  format,
  flatten,
  onChange,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const problem = templateProblem(template);

  const followScroll = (event: React.SyntheticEvent<HTMLInputElement>) => {
    if (mirror.current)
      mirror.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  const insert = (token: string) => {
    const field = input.current;
    const start = field?.selectionStart ?? template.length;
    const end = field?.selectionEnd ?? start;
    const text = `{${token}}`;
    const next = template.slice(0, start) + text + template.slice(end);
    if (next.length > TEMPLATE_LIMIT) return;
    onChange(next);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const paths = images.map((image, i) =>
    exportPath(image, names[i], format, flatten),
  );
  const repeats =
    paths.length - new Set(paths.map((path) => path.toLowerCase())).size;
  const undated =
    usesToken(template, "date") || usesToken(template, "time")
      ? images.filter((image) => image.captured === null).length
      : 0;
  const unrated = usesToken(template, "rating")
    ? images.filter((image) => !image.enriched).length
    : 0;
  const numbered = usesToken(template, "seq");
  const more = images.length - PREVIEW_COUNT;

  return (
    <>
      <div className="relative">
        {/* the input's text is transparent; this copy underneath colours the tokens */}
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre border border-transparent px-3 pr-20 font-mono text-xs"
        >
          {templateParts(template).map((part, i) => (
            <span
              key={i}
              className={cn(
                part.kind === "token" && "text-primary",
                part.kind === "unknown" && "text-destructive",
              )}
            >
              {part.text}
            </span>
          ))}
        </div>
        <Input
          ref={input}
          data-testid="name-template"
          aria-label="File name template"
          aria-invalid={problem !== null}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          maxLength={TEMPLATE_LIMIT}
          value={template}
          onChange={(event) => onChange(event.target.value)}
          onScroll={followScroll}
          onSelect={followScroll}
          className="h-8 pr-20 font-mono text-transparent text-xs caret-foreground md:text-xs"
        />
        <PresetMenu
          template={template}
          recent={recent}
          images={images}
          shoot={shoot}
          onChange={onChange}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        {NAME_TOKENS.map((token) => (
          <Button
            key={token}
            size="xs"
            variant="outline"
            data-testid={`name-token-${token}`}
            onClick={() => insert(token)}
            className="h-5 rounded-md px-1.5 font-mono text-[10px] text-muted-foreground"
          >
            {token}
          </Button>
        ))}
      </div>
      {problem ? (
        <p data-testid="name-problem" className="text-[10px] text-destructive">
          {problem}
        </p>
      ) : (
        images.length > 0 && (
          <div
            data-testid="name-preview"
            className="flex flex-col gap-0.5 font-mono text-[10px] text-muted-foreground"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-1.5 gap-y-0.5">
              {images.slice(0, PREVIEW_COUNT).map((image, i) => (
                <div key={image.path} className="contents">
                  <span className="truncate">{stem(image)}</span>
                  <span title={paths[i]} className="truncate text-foreground">
                    {paths[i]}
                  </span>
                </div>
              ))}
            </div>
            {(more > 0 || numbered) && (
              <span className="font-sans">
                {[
                  more > 0 && `…and ${more} more`,
                  numbered && `numbered in grid order (${SORT_LABELS[sort]})`,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            )}
          </div>
        )
      )}
      {!problem && repeats > 0 && (
        <p
          data-testid="name-repeats"
          className="flex gap-1.5 text-[10px] text-amber-400"
        >
          <TriangleAlert className="mt-px size-3 shrink-0" />
          Some names repeat and get -1, -2. Add {"{seq}"} or {"{original}"} to
          keep them apart.
        </p>
      )}
      {!problem && undated > 0 && (
        <p data-testid="name-undated" className="text-[10px] text-amber-400">
          {pluralize(undated, "photo")} {undated === 1 ? "has" : "have"} no
          capture time loaded and {undated === 1 ? "uses" : "use"} the file
          date.
        </p>
      )}
      {!problem && unrated > 0 && (
        <p data-testid="name-unrated" className="text-[10px] text-amber-400">
          {pluralize(unrated, "photo")} {unrated === 1 ? "is" : "are"} still
          being read, so {"{rating}"} may say 0.
        </p>
      )}
    </>
  );
}
