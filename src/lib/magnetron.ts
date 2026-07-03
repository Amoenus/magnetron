import { z } from "zod";

export const actions = ["index", "download", "both"] as const;
export const contentTypes = [
  "unknown",
  "movie",
  "tv_show",
  "comic",
  "ebook",
  "audiobook",
  "game",
  "music",
  "software",
  "xxx",
] as const;

export const videoResolutions = [
  "V360p",
  "V480p",
  "V540p",
  "V576p",
  "V720p",
  "V1080p",
  "V1440p",
  "V2160p",
  "V4320p",
] as const;

export const videoSources = [
  "CAM",
  "TELESYNC",
  "TELECINE",
  "WORKPRINT",
  "DVD",
  "TV",
  "WEBDL",
  "WEBRip",
  "BluRay",
] as const;

export const videoCodecs = [
  "H264",
  "x264",
  "x265",
  "XviD",
  "DivX",
  "MPEG2",
  "MPEG4",
] as const;

export const videoModifiers = [
  "REGIONAL",
  "SCREENER",
  "RAWHD",
  "BRDISK",
  "REMUX",
] as const;

export const languageHints = [
  "ru",
  "ja",
  "en",
  "uk",
  "de",
  "fr",
  "es",
  "it",
  "ko",
  "zh",
] as const;

export const languageLabels: Record<(typeof languageHints)[number], string> = {
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  uk: "Ukrainian",
  zh: "Chinese",
};

const RELEASE_YEAR_PATTERN = /^\d{4}$/;
const LANGUAGE_INPUT_PATTERN = /^[a-z]{2}(?:\s*,\s*[a-z]{2})*$/i;

export const actionLabels: Record<(typeof actions)[number], string> = {
  index: "Index",
  download: "Download",
  both: "Index + download",
};

export const contentTypeLabels: Record<(typeof contentTypes)[number], string> =
  {
    unknown: "Unknown",
    movie: "Movie",
    tv_show: "TV show",
    comic: "Comic",
    ebook: "Ebook",
    audiobook: "Audiobook",
    game: "Game",
    music: "Music",
    software: "Software",
    xxx: "XXX",
  };

export const intakeSchema = z
  .object({
    magnet: z
      .string()
      .trim()
      .min(1, "Paste a magnet link.")
      .refine(
        (value) => value.startsWith("magnet:?"),
        "Use a valid magnet link."
      ),
    action: z.enum(actions),
    contentType: z.enum(contentTypes),
    contentSource: z.literal("tmdb").or(z.literal("")),
    contentId: z.string().trim(),
    title: z.string().trim().optional(),
    releaseYear: z
      .string()
      .trim()
      .regex(RELEASE_YEAR_PATTERN, "Use a four digit year.")
      .or(z.literal(""))
      .optional(),
    episodes: z.string().trim().optional(),
    videoResolution: z.enum(videoResolutions).or(z.literal("")).optional(),
    videoSource: z.enum(videoSources).or(z.literal("")).optional(),
    videoCodec: z.enum(videoCodecs).or(z.literal("")).optional(),
    videoModifier: z.enum(videoModifiers).or(z.literal("")).optional(),
    languages: z
      .string()
      .trim()
      .regex(LANGUAGE_INPUT_PATTERN, "Use comma-separated language codes.")
      .or(z.literal(""))
      .optional(),
    releaseGroup: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.contentId && !value.contentSource) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentSource"],
        message: "Choose a metadata source for this ID.",
      });
    }
    if (value.contentSource && !value.contentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contentId"],
        message: "Pick a title or enter its TMDB ID.",
      });
    }
  });

export type IntakeInput = z.infer<typeof intakeSchema>;

export interface DownstreamResult {
  health?: "up" | "degraded" | "down";
  message: string;
  ok: boolean;
  status: number | null;
}

export interface CatalogItem {
  action: string;
  bitmagnet: DownstreamResult;
  contentId: string;
  contentSource: string;
  contentType: string;
  discoveredId: string;
  discoveredSource: string;
  discoveredTitle: string;
  episodes: string;
  infoHash: string;
  languages: string;
  leechers: number | null;
  magnet: string;
  name: string;
  qbittorrent: DownstreamResult | null;
  queue?: {
    error: string;
    id: string;
    priority: number | null;
    queue: string;
    runAfter: string;
    status: string;
  };
  releaseGroup: string;
  releaseYear: string;
  seeders: number | null;
  source: "bitmagnet";
  timestamp: string;
  videoCodec: string;
  videoModifier: string;
  videoResolution: string;
  videoSource: string;
  videoSummary: string;
}

export interface CatalogResult {
  catalogTotal: number;
  checkedAt: string;
  hasNextPage: boolean;
  items: CatalogItem[];
  message: string;
  page: number;
  pageSize: number;
  queuedCount: number;
  status: "connected" | "unavailable";
  totalCount: number;
}

export interface TmdbResult {
  contentType: "movie" | "tv_show";
  id: string;
  overview: string;
  releaseYear: string;
  title: string;
}

const RESOLUTION_PATTERN =
  /\b(360p|480p|540p|576p|720p|1080p|1440p|2160p|4320p|4k|8k)\b/i;
const SEASON_EPISODE_PATTERN =
  /\bS(\d{1,2})\s*E(\d{1,3})(?:\s*[-–]\s*E?(\d{1,3}))?\b/i;
const X_EPISODE_PATTERN = /\b(\d{1,2})x(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\b/i;
const SEASON_PATTERN = /\bS(\d{1,2})\b/i;
const YEAR_TOKEN_PATTERN = /^(19\d{2}|20\d{2})$/;
const DASH_RELEASE_GROUP_PATTERN =
  /-\s*([A-Za-z0-9][A-Za-z0-9._-]{1,24})\s*(?:\[[^\]]+\]|\([^)]+\))?\s*$/;
const BRACKET_RELEASE_GROUP_PATTERN =
  /\[([A-Za-z0-9][A-Za-z0-9._-]{1,24})\]\s*$/;
const BAD_RELEASE_GROUP_PATTERN =
  /^(WEB|WEB-DL|HEVC|AVC|BluRay|1080p|720p|2160p)$/i;
const BRACKETED_TAG_PATTERN = /\s*[[(][^\])]*(?:\]|\))/g;
const COMMON_SEPARATOR_PATTERN = /[._]+/g;
const MULTISPACE_PATTERN = /\s{2,}/g;
const TOKEN_SEPARATOR_PATTERN = /\s+/;
const TITLE_TECH_TOKEN_PATTERN =
  /\b(2CH|5\.1|6CH|7\.1|360p|480p|540p|576p|720p|1080p|1440p|2160p|4320p|4k|8k|WEB[- .]?DL|WEB[- .]?Rip|WEBDL|WEBRip|Blu[- .]?Ray|BDRip|BRRip|BDRemux|HDTV|HEVC|AVC|H\.?264|H\.?265|x264|x265|xvid|AAC|FLAC|DDP?\d?\.?\d?|MULTI|REMUX|BRDISK)\b/gi;
const TECH_TOKEN_PATTERN =
  /^(2CH|5\.1|6CH|7\.1|360p|480p|540p|576p|720p|1080p|1440p|2160p|4320p|4k|8k|WEB-?DL|WEB-?Rip|WEBDL|WEBRip|Blu-?Ray|BDRip|BRRip|BDRemux|HDTV|HEVC|AVC|H\.?264|H\.?265|x264|x265|xvid|AAC|FLAC|DDP?\d?\.?\d?|MULTI|REMUX|BRDISK)$/i;
const RUSSIAN_LANGUAGE_PATTERN =
  /\b(RUS|RU|Russian|AniLibria|AniDub|SHIZA|StudioBand|DreamCast)\b/i;
const JAPANESE_LANGUAGE_PATTERN = /\b(JPN|JP|Japanese)\b/i;
const ENGLISH_LANGUAGE_PATTERN = /\b(ENG|EN|English)\b/i;

type VideoSourceHint = Exclude<IntakeInput["videoSource"], undefined | "">;
type VideoCodecHint = Exclude<IntakeInput["videoCodec"], undefined | "">;
type VideoModifierHint = Exclude<IntakeInput["videoModifier"], undefined | "">;

const VIDEO_SOURCE_PATTERNS: [RegExp, VideoSourceHint][] = [
  [/\b(web[- .]?dl|webdl)\b/i, "WEBDL"],
  [/\b(web[- .]?rip|webrip|web)\b/i, "WEBRip"],
  [/\b(bluray|blu[- .]?ray|bdrip|brrip|bdremux)\b/i, "BluRay"],
  [/\b(hdtv|satrip|iptv)\b/i, "TV"],
  [/\b(dvd|dvdrip)\b/i, "DVD"],
  [/\b(cam)\b/i, "CAM"],
];

const VIDEO_CODEC_PATTERNS: [RegExp, VideoCodecHint][] = [
  [/\b(hevc|h\.?265|x265)\b/i, "x265"],
  [/\b(avc|h\.?264)\b/i, "H264"],
  [/\b(x264)\b/i, "x264"],
  [/\b(xvid)\b/i, "XviD"],
  [/\b(divx)\b/i, "DivX"],
];

const VIDEO_MODIFIER_PATTERNS: [RegExp, VideoModifierHint][] = [
  [/\b(remux|bdremux)\b/i, "REMUX"],
  [/\b(bd[- .]?disk|bdis[ck]|blu[- .]?ray[ ._-]?full)\b/i, "BRDISK"],
  [/\b(screener|scr)\b/i, "SCREENER"],
  [/\b(raw[- .]?hd)\b/i, "RAWHD"],
  [/\b(regional)\b/i, "REGIONAL"],
];

export function inferTorrentHints(name: string): Partial<IntakeInput> {
  const normalized = decodeURIComponent(name).replaceAll("+", " ");
  const releaseGroup = inferReleaseGroup(normalized);
  return {
    episodes: inferEpisodes(normalized),
    languages: inferLanguages(normalized),
    releaseGroup,
    releaseYear: inferReleaseYear(normalized),
    title: inferTitle(normalized, releaseGroup),
    videoCodec: firstPatternValue(normalized, VIDEO_CODEC_PATTERNS),
    videoModifier: firstPatternValue(normalized, VIDEO_MODIFIER_PATTERNS),
    videoResolution: inferVideoResolution(normalized),
    videoSource: firstPatternValue(normalized, VIDEO_SOURCE_PATTERNS),
  };
}

function inferLanguages(value: string) {
  const languages = new Set<string>();
  if (RUSSIAN_LANGUAGE_PATTERN.test(value)) {
    languages.add("ru");
  }
  if (JAPANESE_LANGUAGE_PATTERN.test(value)) {
    languages.add("ja");
  }
  if (ENGLISH_LANGUAGE_PATTERN.test(value)) {
    languages.add("en");
  }
  return [...languages].join(", ");
}

function inferTitle(value: string, releaseGroup?: string) {
  const withoutTags = value.replace(BRACKETED_TAG_PATTERN, " ");
  const withoutExplicitReleaseGroup = withoutTags.replace(
    DASH_RELEASE_GROUP_PATTERN,
    " "
  );
  const withoutReleaseGroup = releaseGroup
    ? removeTrailingToken(withoutExplicitReleaseGroup, releaseGroup)
    : withoutExplicitReleaseGroup;
  const titleCandidate = titleSegmentBeforeEpisode(withoutReleaseGroup);
  const withoutEpisodes = titleCandidate
    .replace(SEASON_EPISODE_PATTERN, " ")
    .replace(X_EPISODE_PATTERN, " ")
    .replace(SEASON_PATTERN, " ");
  const title = withoutEpisodes
    .replace(TITLE_TECH_TOKEN_PATTERN, " ")
    .replace(COMMON_SEPARATOR_PATTERN, " ")
    .replace(MULTISPACE_PATTERN, " ")
    .trim();
  if (!title) {
    return;
  }
  return title;
}

function titleSegmentBeforeEpisode(value: string) {
  const episodeIndex = firstEpisodeIndex(value);
  const titleSegment =
    episodeIndex === -1 ? value : value.slice(0, episodeIndex);
  return titleSegment
    .split(TOKEN_SEPARATOR_PATTERN)
    .filter((token) => !YEAR_TOKEN_PATTERN.test(token))
    .join(" ");
}

function firstEpisodeIndex(value: string) {
  const indexes = [
    value.search(SEASON_EPISODE_PATTERN),
    value.search(X_EPISODE_PATTERN),
    value.search(SEASON_PATTERN),
  ].filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function inferReleaseYear(value: string) {
  const episodeIndex = firstEpisodeIndex(value);
  const titleSegment =
    episodeIndex === -1 ? value : value.slice(0, episodeIndex);
  return titleSegment
    .split(TOKEN_SEPARATOR_PATTERN)
    .find((token) => YEAR_TOKEN_PATTERN.test(token));
}

function inferVideoResolution(value: string): IntakeInput["videoResolution"] {
  const resolution = value.match(RESOLUTION_PATTERN)?.[1]?.toLowerCase();
  if (!resolution) {
    return "";
  }
  if (resolution === "4k") {
    return "V2160p";
  }
  if (resolution === "8k") {
    return "V4320p";
  }
  return `V${resolution}` as IntakeInput["videoResolution"];
}

function inferEpisodes(value: string) {
  const episode =
    value.match(SEASON_EPISODE_PATTERN) ?? value.match(X_EPISODE_PATTERN);
  if (episode) {
    return formatEpisodeRange(episode);
  }

  const season = value.match(SEASON_PATTERN)?.[1];
  if (!season) {
    return;
  }
  return `S${Number.parseInt(season, 10).toString().padStart(2, "0")}`;
}

function formatEpisodeRange(match: RegExpMatchArray) {
  const season = Number.parseInt(match[1] ?? "", 10);
  const first = Number.parseInt(match[2] ?? "", 10);
  const last = Number.parseInt(match[3] ?? "", 10);
  const prefix = `S${season.toString().padStart(2, "0")}E${first
    .toString()
    .padStart(2, "0")}`;
  if (!(Number.isFinite(last) && last > first)) {
    return prefix;
  }
  return `${prefix}-${last.toString().padStart(2, "0")}`;
}

function inferReleaseGroup(value: string) {
  const releaseGroup =
    value.match(DASH_RELEASE_GROUP_PATTERN)?.[1] ??
    value.match(BRACKET_RELEASE_GROUP_PATTERN)?.[1] ??
    inferTrailingReleaseGroup(value);
  if (!releaseGroup || BAD_RELEASE_GROUP_PATTERN.test(releaseGroup)) {
    return;
  }
  return releaseGroup;
}

function inferTrailingReleaseGroup(value: string) {
  const tokens = tokenizeReleaseName(value);
  const releaseGroup = tokens.at(-1);
  if (!releaseGroup || TECH_TOKEN_PATTERN.test(releaseGroup)) {
    return;
  }

  const precedingTokens = tokens.slice(0, -1);
  const hasTorrentMarker = precedingTokens.some(isTorrentMarkerToken);
  if (!hasTorrentMarker) {
    return;
  }

  return releaseGroup;
}

function tokenizeReleaseName(value: string) {
  return value
    .replace(BRACKETED_TAG_PATTERN, " ")
    .replace(COMMON_SEPARATOR_PATTERN, " ")
    .replace(MULTISPACE_PATTERN, " ")
    .trim()
    .split(TOKEN_SEPARATOR_PATTERN)
    .filter(Boolean);
}

function isTorrentMarkerToken(token: string) {
  return (
    TECH_TOKEN_PATTERN.test(token) ||
    SEASON_EPISODE_PATTERN.test(token) ||
    X_EPISODE_PATTERN.test(token)
  );
}

function removeTrailingToken(value: string, token: string) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return value.replace(new RegExp(`\\s+${escaped}\\s*$`), " ");
}

function firstPatternValue<T extends string>(
  value: string,
  patterns: [RegExp, T][]
): T | "" {
  return patterns.find(([pattern]) => pattern.test(value))?.[1] ?? "";
}
