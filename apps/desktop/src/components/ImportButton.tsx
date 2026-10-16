import { Button } from "@photopipe/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@photopipe/ui/components/dropdown-menu";
import { Download, FolderOpen, Images } from "lucide-react";
import type { ComponentProps } from "react";
import { useFeatures } from "@/lib/features";
import type { PhotoSource } from "@/lib/roots";

type Props = Pick<ComponentProps<typeof Button>, "variant" | "className"> & {
  testId: string;
  onImport: (from: PhotoSource) => void;
};

export function ImportButton({ testId, onImport, variant, className }: Props) {
  const { photoLibrary } = useFeatures();
  const button = (
    <Button
      size="sm"
      variant={variant}
      data-testid={testId}
      className={className}
      onClick={photoLibrary ? undefined : () => onImport("files")}
    >
      <Download />
      Import photos
    </Button>
  );
  if (!photoLibrary) return button;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onImport("files")}>
          <FolderOpen />
          From Files
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onImport("library")}>
          <Images />
          From Photos
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
