import { llmsTxt } from "@/lib/markdown";

export const dynamic = "force-static";

export async function GET() {
  return new Response(await llmsTxt());
}
