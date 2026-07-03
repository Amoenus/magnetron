import { AlertCircle, Check, Loader2, MinusCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { Readiness } from "./types";

export function LiveStatus({
  readiness,
  loading,
}: {
  readiness?: Readiness;
  loading: boolean;
}) {
  const bitmagnetOk = readiness?.bitmagnet.ok;
  const qbitOk = readiness?.qbittorrent.ok;
  const tmdbOk = readiness?.tmdb.ok;
  const bitmagnetHealth = readiness?.bitmagnet.health;
  const tmdbHealth = readiness?.tmdb.health;

  return (
    <div className="grid w-full gap-2 rounded-lg border border-border/70 bg-card/85 p-2 shadow-[0_16px_60px_oklch(0_0_0/0.18)] sm:w-auto sm:min-w-[24rem] sm:grid-cols-3">
      <StatusPill
        detail={readiness?.bitmagnet.message}
        label="bitmagnet"
        loading={loading}
        ok={bitmagnetOk}
        state={bitmagnetHealth}
      />
      <StatusPill
        detail={readiness?.qbittorrent.message}
        label="qBittorrent"
        loading={loading}
        ok={qbitOk}
      />
      <StatusPill
        detail={readiness?.tmdb.message}
        label="TMDB"
        loading={loading}
        ok={tmdbOk}
        state={tmdbHealth}
      />
    </div>
  );
}

function StatusPill({
  label,
  ok,
  loading,
  detail,
  state,
}: {
  label: string;
  ok?: boolean;
  loading: boolean;
  detail?: string;
  state?: "up" | "degraded" | "down";
}) {
  let icon = <AlertCircle className="size-3.5 text-destructive" />;
  if (loading && ok === undefined) {
    icon = <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  } else if (state === "degraded") {
    icon = <MinusCircle className="size-3.5 text-amber-400" />;
  } else if (ok) {
    icon = <Check className="size-3.5 text-primary" />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-background/50 px-2.5 py-2 text-sm transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]">
          {icon}
          <span className="truncate font-medium">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {detail || (ok ? "Connected" : "Unavailable")}
      </TooltipContent>
    </Tooltip>
  );
}
