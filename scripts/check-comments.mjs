import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SLASH_COMMENT = /(^|[\s{(,;])(\/\/|\/\*)/;
const COMMENT_BY_EXTENSION = {
  ts: SLASH_COMMENT,
  tsx: SLASH_COMMENT,
  mjs: SLASH_COMMENT,
  swift: SLASH_COMMENT,
  rs: SLASH_COMMENT,
  css: /(^|[\s{(,;])\/\*/,
  sh: /(^|\s)#(?!!)/,
};
const DIRECTIVE = /biome-ignore|swift-tools-version|\/\/\/ <reference/;
const GENERATED =
  /^(packages\/ui\/src\/components|apps\/desktop\/src-tauri\/gen)\//;

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((file) => !GENERATED.test(file) && existsSync(file));

const violations = files.flatMap((file) => {
  const comment = COMMENT_BY_EXTENSION[file.split(".").pop()];
  if (!comment) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line, index) =>
      comment.test(line) && !DIRECTIVE.test(line)
        ? [`${file}:${index + 1}: ${line.trim()}`]
        : [],
    );
});

if (violations.length > 0) {
  console.error(violations.join("\n"));
  console.error(
    "\nComments are banned. Code it properly: if the code needs explaining, rename or restructure it until it doesn't; if it works around a problem, fix the problem now.",
  );
  process.exit(1);
}
