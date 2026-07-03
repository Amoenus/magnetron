import { ExternalLink } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import type { Readiness, SettingsOutput } from "./types";

export function SettingsPanel({
  settings,
  loading,
  readiness,
}: {
  settings?: SettingsOutput;
  loading: boolean;
  readiness?: Readiness;
}) {
  if (loading || !settings) {
    return <Skeleton className="h-96 rounded-lg" />;
  }

  const rows = [
    ["BITMAGNET_URL", settings.bitmagnetUrl],
    ["BITMAGNET_SOURCE", settings.bitmagnetSource],
    ["QBITTORRENT_URL", settings.qbittorrentUrl],
    ["QBITTORRENT_CATEGORY", settings.qbittorrentCategory],
    ["QBITTORRENT_TAGS", settings.qbittorrentTags],
    [
      "QBITTORRENT_API_KEY",
      settings.qbittorrentApiKeyConfigured ? "Configured" : "Missing",
    ],
    ["TMDB_API_KEY", settings.tmdbConfigured ? "Configured" : "Missing"],
    ["DEFAULT_ACTION", settings.defaultAction],
    ["MAGNETRON_VERSION", settings.appVersion],
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
      <Card className="rounded-lg border-border/70 bg-card/88">
        <CardHeader>
          <CardTitle>Runtime configuration</CardTitle>
          <CardDescription>Environment-backed runtime values.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.map(([key, value]) => (
            <div
              className="grid gap-2 rounded-md border border-border/70 bg-background/35 p-3 sm:grid-cols-[14rem_1fr]"
              key={key}
            >
              <div className="font-mono text-muted-foreground text-xs">
                {key}
              </div>
              <div className="min-w-0 truncate font-medium text-sm">
                {value}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-lg border-border/70 bg-card/88">
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Latest live status responses.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CheckRow label="bitmagnet" result={readiness?.bitmagnet} />
          <Separator />
          <CheckRow label="qBittorrent" result={readiness?.qbittorrent} />
          <Separator />
          <CheckRow label="TMDB" result={readiness?.tmdb} />
          <Button asChild className="w-full" variant="outline">
            <a
              href="https://create.t3.gg/en/installation"
              rel="noopener"
              target="_blank"
            >
              <ExternalLink className="size-4" />
              T3 installation docs
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CheckRow({
  label,
  result,
}: {
  label: string;
  result?: {
    health?: "up" | "degraded" | "down";
    ok: boolean;
    status: number | null;
    message: string;
  };
}) {
  const statusLabel = checkStatusLabel(result);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-sm">{label}</span>
        <Badge variant={result?.ok ? "secondary" : "destructive"}>
          {statusLabel}
        </Badge>
      </div>
      <p className="line-clamp-3 text-muted-foreground text-xs">
        {result?.message || "No response yet."}
      </p>
    </div>
  );
}

function checkStatusLabel(result?: {
  health?: "up" | "degraded" | "down";
  ok: boolean;
}) {
  if (result?.health === "degraded") {
    return "Degraded";
  }
  return result?.ok ? "OK" : "Failed";
}
