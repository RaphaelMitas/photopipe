import { llmsFullTxt, markdownResponse } from "@/lib/markdown";

export const revalidate = 3600;

export async function GET() {
  return markdownResponse(await llmsFullTxt());
}
