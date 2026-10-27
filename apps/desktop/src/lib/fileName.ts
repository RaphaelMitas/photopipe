export const fileName = (path: string) => path.split("/").pop() || path;

/// The folder part keeps its trailing slash, and is empty at the root.
export function splitRel(rel: string): [string, string] {
  const cut = rel.lastIndexOf("/");
  return cut === -1 ? ["", rel] : [rel.slice(0, cut + 1), rel.slice(cut + 1)];
}
