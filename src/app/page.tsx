import { MagnetronApp } from "~/app/_components/magnetron-app";
import { env } from "~/env";
import { HydrateClient } from "~/trpc/server";

export default async function Home() {
  return (
    <HydrateClient>
      <MagnetronApp defaultAction={env.DEFAULT_ACTION} />
    </HydrateClient>
  );
}
