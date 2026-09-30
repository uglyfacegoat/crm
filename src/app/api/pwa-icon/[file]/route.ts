import { renderCoreAppIcon } from "@/lib/core-app-icon";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (file !== "180.png" && file !== "192.png" && file !== "512.png") {
    return new Response("Not found", { status: 404 });
  }
  return renderCoreAppIcon(Number.parseInt(file, 10) as 180 | 192 | 512);
}
