export const fileName = (path: string) => path.split("/").pop() || path;

export function splitRel(rel: string): [string, string] {
  const cut = rel.lastIndexOf("/");
  return cut === -1 ? ["", rel] : [rel.slice(0, cut + 1), rel.slice(cut + 1)];
}
