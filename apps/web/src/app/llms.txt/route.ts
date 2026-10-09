import { llmsTxt } from "@/lib/markdown";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

export async function GET() {
  return new Response(await llmsTxt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${SITE_URL}>; rel="canonical"`,
    },
  });
}
