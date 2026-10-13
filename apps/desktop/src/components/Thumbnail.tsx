import { Skeleton } from "@photopipe/ui/components/skeleton";
import { cn } from "@photopipe/ui/lib/utils";
import { fileSrc, type ImageFile } from "@/lib/core";
import { useThumbnail } from "@/lib/queries";

export function aspectRatio(image: Pick<ImageFile, "width" | "height">) {
  return image.width > 0 && image.height > 0 ? image.width / image.height : 1.5;
}

type Props = {
  file: Pick<ImageFile, "path" | "mtime"> & { rel?: string };
  alt?: string;
  className?: string;
  "data-testid"?: string;
};

export function Thumbnail({
  file,
  alt = file.rel ?? "",
  className,
  "data-testid": testid,
}: Props) {
  const thumb = useThumbnail(file);
  if (thumb.data) {
    return (
      <img
        data-testid={testid}
        src={fileSrc(thumb.data)}
        alt={alt}
        loading="lazy"
        className={cn("object-cover", className)}
      />
    );
  }
  if (thumb.isError) {
    return <div className={cn("bg-muted/40", className)} />;
  }
  return <Skeleton className={cn("rounded-none", className)} />;
}
