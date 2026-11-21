import { CONTROLS, DEVELOP } from "@/components/DevelopSection";
import { EVERYTHING_ELSE, FEATURES } from "@/components/FeatureGrid";
import { INSTINCT, NUMBERS } from "@/components/InstinctSection";
import { FAQ, type FaqItem } from "@/lib/faq";
import { INTENT_PAGES, type IntentPage } from "@/lib/intent-pages";
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

${version ? `Current version: ${version}. ` : ""}Requires macOS 15 (Sequoia) or later on Apple Silicon, or iPadOS 18 or later. Free, open source (MIT).

- Mac App Store: ${APP_STORE}
- DMG: ${downloadUrl(version)}
- Homebrew: \`${BREW_INSTALL}\``;
}

function questions(items: FaqItem[], heading = "###") {
  return items
    .map((item) => `${heading} ${item.question}\n\n${item.answer}`)
    .join("\n\n");
}

function faq() {
  return `## FAQ

${questions(FAQ)}`;
}

function bullets(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function comparison(page: IntentPage) {
  return `## ${page.title}

URL: ${SITE_URL}/${page.slug}
Updated: ${page.updated}

${page.lede}

### Photopipe or ${page.rival}?

Pick Photopipe if:

${bullets(page.pick.photopipe)}

Pick ${page.rival} if:

${bullets(page.pick.rival)}

| | Photopipe | ${page.rival} |
| --- | --- | --- |
${page.comparison.map((row) => `| ${row.feature} | ${row.photopipe} | ${row.rival} |`).join("\n")}

### ${page.workflow.title}

${page.workflow.steps.map((step, index) => `${index + 1}. **${step.title}.** ${step.body}`).join("\n")}

### ${page.faqTitle}

${questions(page.faq, "####")}`;
}

export async function llmsTxt() {
  return `# Photopipe

> ${DESCRIPTION}

${await install()}

${faq()}

## Docs

- [Full site as Markdown](${SITE_URL}/llms-full.txt): every feature and the comparison pages, in one file
${INTENT_PAGES.map((page) => `- [${page.title}](${SITE_URL}/${page.slug}): ${page.description}`).join("\n")}
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

${INTENT_PAGES.map(comparison).join("\n\n")}
`;
}

export function markdownResponse(body: string) {
  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${SITE_URL}>; rel="canonical"`,
    },
  });
}
