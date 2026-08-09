#!/usr/bin/env node
/**
 * Cuts a release: bumps the version everywhere, refreshes the README
 * screenshots, pushes a release/vX.Y.Z branch and opens an auto-merging PR.
 * Once that PR lands on main, .github/workflows/release.yml tags the commit,
 * builds, signs, notarizes, publishes the DMG and bumps the Homebrew cask.
 *
 * Usage: pnpm release [patch|minor|major|<x.y.z>] [--direct] [--dry-run]
 *   --direct     commit the bump straight to main (skips the PR)
 *   --dry-run    print the plan without writing or pushing anything
 *   --no-shots   skip regenerating screenshots
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONF = "apps/desktop/src-tauri/tauri.conf.json";
const APP_PKG = "apps/desktop/package.json";
const CARGO = "apps/desktop/src-tauri/Cargo.toml";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
    ...opts,
  })?.trimEnd();
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const direct = args.includes("--direct");
const dryRun = args.includes("--dry-run");
const noShots = args.includes("--no-shots");
const bump = args.find((a) => !a.startsWith("--")) ?? "patch";

// In --dry-run the guards report instead of aborting, so the plan prints
// from any branch or state.
function guard(ok, message) {
  if (ok) return;
  if (dryRun) console.warn(`! would fail: ${message}`);
  else fail(message);
}

guard(
  run("git", ["status", "--porcelain"]) === "",
  "Working tree is not clean; commit or stash first.",
);

const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
guard(
  branch === "main",
  `Releases start from main (currently on "${branch}").`,
);

run("git", ["fetch", "origin", "main"]);
guard(
  run("git", ["rev-parse", "HEAD"]) ===
    run("git", ["rev-parse", "origin/main"]),
  "Local main is not in sync with origin/main; pull (or push) first.",
);

const current = JSON.parse(readFileSync(join(repoRoot, CONF), "utf8")).version;
const [major, minor, patch] = current.split(".").map(Number);
const next =
  bump === "major"
    ? `${major + 1}.0.0`
    : bump === "minor"
      ? `${major}.${minor + 1}.0`
      : bump === "patch"
        ? `${major}.${minor}.${patch + 1}`
        : bump;

if (!/^\d+\.\d+\.\d+$/.test(next)) {
  fail(
    `Invalid version or bump type "${bump}" (expected patch, minor, major, or x.y.z).`,
  );
}
if (
  run("git", ["ls-remote", "--tags", "origin", `refs/tags/v${next}`]) !== ""
) {
  fail(`Tag v${next} already exists on origin.`);
}

console.log(`Releasing v${next} (current: v${current})`);

if (dryRun) {
  console.log(`
Dry run; nothing written or pushed. A real run would:
  1. set ${next} in tauri.conf.json, package.json, Cargo.toml and Cargo.lock
  2. ${noShots ? "skip screenshots" : "regenerate docs/screenshots from the live UI"}${
    direct
      ? `
  3. commit "Release v${next}" on main and push`
      : `
  3. push branch release/v${next} and open a PR with auto-merge`
  }
  4. on merge to main, the Release workflow tags v${next}, builds, signs and
     notarizes the app, publishes the DMG and zip, and bumps the Homebrew cask`);
  process.exit(0);
}

// The workflow refuses to build when these disagree, so keep them in step.
for (const path of [CONF, APP_PKG]) {
  const full = join(repoRoot, path);
  const text = readFileSync(full, "utf8");
  const updated = text.replace(/("version":\s*")[^"]*(")/, `$1${next}$2`);
  if (updated === text) fail(`Could not find a version field in ${path}`);
  writeFileSync(full, updated);
}
const cargoPath = join(repoRoot, CARGO);
const cargo = readFileSync(cargoPath, "utf8");
const cargoUpdated = cargo.replace(
  /^(version\s*=\s*")[^"]*(")/m,
  `$1${next}$2`,
);
if (cargoUpdated === cargo) fail(`Could not find a version field in ${CARGO}`);
writeFileSync(cargoPath, cargoUpdated);

// Cargo.lock pins the local crate; let cargo rewrite it rather than editing
// the lockfile by hand.
run("cargo", ["metadata", "--format-version", "1"], {
  cwd: join(repoRoot, "apps/desktop/src-tauri"),
  stdio: ["inherit", "ignore", "inherit"],
});
console.log("✓ Bumped tauri.conf.json, package.json, Cargo.toml, Cargo.lock");

if (!noShots) {
  // Captured from the running UI, so the README can never show a version of
  // the app that no longer exists.
  console.log("Refreshing screenshots...");
  run("pnpm", ["--filter", "desktop", "screenshots"], { stdio: "inherit" });
  console.log("✓ Screenshots refreshed");
}

run("git", ["add", "-A"]);

if (direct) {
  run("git", ["commit", "-m", `Release v${next}`]);
  run("git", ["push", "origin", "main"]);
  console.log("✓ Pushed release commit to main.");
} else {
  const releaseBranch = `release/v${next}`;
  run("git", ["checkout", "-b", releaseBranch]);
  run("git", ["commit", "-m", `Release v${next}`]);
  run("git", ["push", "-u", "origin", releaseBranch]);

  const body = [
    `Bumps Photopipe to v${next} and refreshes the README screenshots.`,
    "",
    "Once this lands on main, the Release workflow will:",
    `1. tag the merge commit as v${next}`,
    "2. build the app, sign it inside-out and notarize it with Apple",
    "3. publish the stapled DMG and zip to a GitHub release",
    "4. bump `Casks/photopipe.rb` in RaphaelMitas/homebrew-tap",
    "",
    "The screenshots in this diff are what the README will show.",
  ].join("\n");
  console.log(
    run("gh", ["pr", "create", "--title", `Release v${next}`, "--body", body]),
  );
  try {
    run("gh", ["pr", "merge", "--auto", "--squash"]);
    console.log("✓ Auto-merge enabled; the release starts when CI passes.");
  } catch {
    console.log(
      "Could not enable auto-merge; merge the PR to start the release.",
    );
  }
  run("git", ["checkout", "main"]);
}

console.log(
  `✓ v${next} is on its way. Watch: gh run watch, or the Actions tab.`,
);
