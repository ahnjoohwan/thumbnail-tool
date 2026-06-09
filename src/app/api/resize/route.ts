import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

const MIME_MAP: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tiff: "image/tiff",
};

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const widthStr = form.get("width") as string | null;
    const heightStr = form.get("height") as string | null;

    if (!file || !widthStr || !heightStr) {
      return NextResponse.json({ error: "파일, 너비, 높이는 필수입니다." }, { status: 400 });
    }

    const width = parseInt(widthStr, 10);
    const height = parseInt(heightStr, 10);

    if (isNaN(width) || isNaN(height) || width < 1 || height < 1 || width > 10000 || height > 10000) {
      return NextResponse.json({ error: "너비와 높이는 1~10000 사이의 정수여야 합니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = await sharp(buffer).metadata();
    const format = meta.format ?? "jpeg";

    const output = await sharp(buffer)
      .resize(width, height, { fit: "cover", position: "centre" })
      .toBuffer();

    const mimeType = MIME_MAP[format] ?? "image/jpeg";

    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="resized.${format}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
