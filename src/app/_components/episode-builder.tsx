import { CalendarDays } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

const DIGIT_PATTERN = /\D/g;
const BUILDER_ABSOLUTE_EPISODE_PATTERN = /^E(\d{1,5})(?:[-–]E?(\d{1,5}))?$/i;
const BUILDER_SEASON_EPISODE_PATTERN =
  /^S?(\d{1,2})E(\d{1,3})(?:[-–]E?(\d{1,3}))?$/i;
const BUILDER_SEASON_PATTERN = /^S?(\d{1,2})$/i;

type EpisodeMode = "single" | "range" | "season" | "absolute";

export function EpisodeBuilder({
  value,
  onApply,
}: {
  value: string;
  onApply: (value: string) => void;
}) {
  const parsed = parseEpisodeBuilderValue(value);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<EpisodeMode>(parsed.mode);
  const [season, setSeason] = useState(parsed.season);
  const [episodeStart, setEpisodeStart] = useState(parsed.episodeStart);
  const [episodeEnd, setEpisodeEnd] = useState(parsed.episodeEnd);

  useEffect(() => {
    if (open) {
      const next = parseEpisodeBuilderValue(value);
      setMode(next.mode);
      setSeason(next.season);
      setEpisodeStart(next.episodeStart);
      setEpisodeEnd(next.episodeEnd);
    }
  }, [open, value]);

  const preview = formatEpisodeBuilderValue({
    episodeEnd,
    episodeStart,
    mode,
    season,
  });

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label="Build episode value"
              size="icon"
              type="button"
              variant="outline"
            >
              <CalendarDays className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Build episode value</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          <ToggleGroup
            className="grid w-full grid-cols-2 gap-1"
            onValueChange={(nextMode) => {
              if (nextMode) {
                setMode(nextMode as EpisodeMode);
              }
            }}
            type="single"
            value={mode}
            variant="outline"
          >
            <ToggleGroupItem value="single">Episode</ToggleGroupItem>
            <ToggleGroupItem value="range">Range</ToggleGroupItem>
            <ToggleGroupItem value="season">Season</ToggleGroupItem>
            <ToggleGroupItem value="absolute">Absolute</ToggleGroupItem>
          </ToggleGroup>

          <div className="grid grid-cols-3 gap-2">
            {mode !== "absolute" && (
              <EpisodeNumberInput
                label="Season"
                onChange={setSeason}
                placeholder="9"
                value={season}
              />
            )}
            {mode !== "season" && (
              <EpisodeNumberInput
                label={mode === "absolute" ? "Episode" : "Start"}
                onChange={setEpisodeStart}
                placeholder={mode === "absolute" ? "1042" : "6"}
                value={episodeStart}
              />
            )}
            {(mode === "range" || mode === "absolute") && (
              <EpisodeNumberInput
                label="End"
                onChange={setEpisodeEnd}
                placeholder={mode === "absolute" ? "1044" : "8"}
                value={episodeEnd}
              />
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <code className="min-w-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs">
              {preview || "No episode selected"}
            </code>
            <Button
              disabled={!preview}
              onClick={() => {
                onApply(preview);
                setOpen(false);
              }}
              type="button"
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EpisodeNumberInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  const inputId = `episode-builder-${label.toLowerCase()}`;
  return (
    <div className="grid gap-1 text-xs">
      <label className="text-muted-foreground" htmlFor={inputId}>
        {label}
      </label>
      <Input
        id={inputId}
        inputMode="numeric"
        onChange={(event) =>
          onChange(event.target.value.replaceAll(DIGIT_PATTERN, ""))
        }
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}

function parseEpisodeBuilderValue(value: string) {
  const trimmed = value.trim();
  const absolute = trimmed.match(BUILDER_ABSOLUTE_EPISODE_PATTERN);
  if (absolute) {
    return {
      episodeEnd: absolute[2] ?? "",
      episodeStart: absolute[1] ?? "",
      mode: "absolute" as EpisodeMode,
      season: "",
    };
  }

  const episode = trimmed.match(BUILDER_SEASON_EPISODE_PATTERN);
  if (episode) {
    return {
      episodeEnd: episode[3] ?? "",
      episodeStart: episode[2] ?? "",
      mode: episode[3] ? "range" : ("single" as EpisodeMode),
      season: episode[1] ?? "",
    };
  }

  const season = trimmed.match(BUILDER_SEASON_PATTERN);
  return {
    episodeEnd: "",
    episodeStart: "",
    mode: season ? ("season" as EpisodeMode) : ("single" as EpisodeMode),
    season: season?.[1] ?? "",
  };
}

function formatEpisodeBuilderValue({
  mode,
  season,
  episodeStart,
  episodeEnd,
}: {
  mode: EpisodeMode;
  season: string;
  episodeStart: string;
  episodeEnd: string;
}) {
  if (mode === "absolute") {
    if (!episodeStart) {
      return "";
    }
    return episodeEnd ? `E${episodeStart}-${episodeEnd}` : `E${episodeStart}`;
  }
  if (!season) {
    return "";
  }
  const seasonLabel = `S${season.padStart(2, "0")}`;
  if (mode === "season") {
    return seasonLabel;
  }
  if (!episodeStart) {
    return "";
  }
  const episodeLabel = `${seasonLabel}E${episodeStart.padStart(2, "0")}`;
  return mode === "range" && episodeEnd
    ? `${episodeLabel}-${episodeEnd.padStart(2, "0")}`
    : episodeLabel;
}
