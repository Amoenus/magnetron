import { env } from "~/env";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      service: "magnetron",
      status: "ready",
      version: env.MAGNETRON_VERSION ?? "dev",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
