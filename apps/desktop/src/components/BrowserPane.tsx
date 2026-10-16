import type { ImageFile } from "@/lib/core";
import type { ScoreProgress } from "@/lib/queries";
import type { PhotoSource } from "@/lib/roots";
import type { SelectModifiers } from "@/lib/selection";
import { type SortKey, sortPref } from "@/lib/sort";
import { showInfoPref } from "./AppSidebar";
import { BrowserToolbar, viewPref } from "./BrowserToolbar";
import { ImageGrid } from "./ImageGrid";
import { ImageList } from "./ImageList";
import { ImportButton } from "./ImportButton";

type Props = {
  images: ImageFile[];
  sort: SortKey;
  scoreReady: boolean;
  scoring: ScoreProgress | null;
  justRated: boolean;
  filterActive: boolean;
  selected: ReadonlySet<string>;
  onSelect: (path: string, modifiers: SelectModifiers) => void;
  focusPath: string | null;
  revealed: number;
  onOpen: (index: number) => void;
  onImport: (from: PhotoSource) => void;
};

export function BrowserPane({
  images,
  sort,
  scoreReady,
  scoring,
  justRated,
  filterActive,
  selected,
  onSelect,
  focusPath,
  revealed,
  onOpen,
  onImport,
}: Props) {
  const view = viewPref.use();
  const showInfo = showInfoPref.use();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BrowserToolbar
        purpose="Cull and rate. Click a photo for the loupe; Export takes the selection."
        view={view}
        onView={viewPref.set}
        sort={sort}
        onSort={sortPref.set}
        scoreReady={scoreReady}
        scoring={scoring}
        justRated={justRated}
      />
      {images.length === 0 ? (
        <div className="flex flex-col items-start gap-3 p-8">
          <p
            data-testid="browser-empty"
            className="text-muted-foreground text-sm"
          >
            {filterActive
              ? "Nothing matches the rating filter."
              : "No photos in this project yet. Import them, or drop files into the folder — subfolders are fine."}
          </p>
          {!filterActive && (
            <ImportButton testId="empty-import" onImport={onImport} />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          {view === "grid" ? (
            <ImageGrid
              images={images}
              onOpen={onOpen}
              showInfo={showInfo}
              selected={selected}
              onSelect={onSelect}
              focusPath={focusPath}
              revealed={revealed}
            />
          ) : (
            <ImageList
              images={images}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              focusPath={focusPath}
              revealed={revealed}
            />
          )}
        </div>
      )}
    </div>
  );
}
