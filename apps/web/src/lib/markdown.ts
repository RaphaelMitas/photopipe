import { CONTROLS, DEVELOP } from "@/components/DevelopSection";
import { EVERYTHING_ELSE, FEATURES } from "@/components/FeatureGrid";
import { INSTINCT, NUMBERS } from "@/components/InstinctSection";
import { FAQ } from "@/lib/faq";
import {
  APP_STORE,
  BREW_INSTALL,
  downloadUrl,
  latestVersion,
  REPO,
} from "@/lib/release";
import { DESCRIPTION, SITE_URL } from "@/lib/site";

async function install() {
  const version = await latestVersion();
  return `## Install

${version ? `Current version: ${version}. ` : ""}Requires macOS 15 (Sequoia) or later on Apple Silicon. Free, open source (MIT).

- Mac App Store: ${APP_STORE}
- DMG: ${downloadUrl(version)}
- Homebrew: \`${BREW_INSTALL}\``;
}

function faq() {
  return `## FAQ

${FAQ.map((item) => `### ${item.question}\n\n${item.answer}`).join("\n\n")}`;
}

export async function llmsTxt() {
  return `# Photopipe

> ${DESCRIPTION}

${await install()}

${faq()}

## Docs

- [Full page as Markdown](${SITE_URL}/llms-full.txt): every feature, in one file
- [Privacy](${SITE_URL}/privacy): no account, no telemetry, no uploads
- [Source code](${REPO}): MIT licence
- [Design notes](${REPO}/blob/main/docs/design.md): why it works the way it does
- [Releases](${REPO}/releases)
`;
}

export async function llmsFullTxt() {
  return `# Photopipe

> ${DESCRIPTION}

Website: ${SITE_URL}

${await install()}

## ${DEVELOP.title}

${DEVELOP.lede}

${CONTROLS.map((control) => `- **${control.name}**: ${control.detail}`).join("\n")}

## ${INSTINCT.title}

${INSTINCT.lede}

${NUMBERS.map((number) => `- **${number.value}**: ${number.label}`).join("\n")}

## ${EVERYTHING_ELSE.title}

${FEATURES.map((feature) => `### ${feature.title}\n\n${feature.body}`).join("\n\n")}

${faq()}
`;
}
