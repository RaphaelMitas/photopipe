import { llmsFullTxt } from "@/lib/markdown";
import { SITE_URL } from "@/lib/site";

export const revalidate = 3600;

export async function GET() {
  return new Response(await llmsFullTxt(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${SITE_URL}>; rel="canonical"`,
    },
  });
}
