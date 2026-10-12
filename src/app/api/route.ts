import { NextResponse } from "next/server";

// This route is left over from the Next.js scaffold. The Big Con FPS Battle
// Royale is fully client-side (PeerJS for multiplayer, Three.js for rendering),
// so there is no server API to call. We mark it `force-static` so Next.js can
// export it as part of a static site build (Render.com Static Site, Cloudflare
// Pages, Vercel static, etc.).
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}
