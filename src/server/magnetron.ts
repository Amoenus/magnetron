import "server-only";

import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import {
  type CatalogItem,
  type CatalogResult,
  contentTypes,
  type DownstreamResult,
  type IntakeInput,
  type TmdbResult,
} from "~/lib/magnetron";
import packageJson from "../../package.json";

const INFO_HASH_HEX = /^[A-Fa-f0-9]{40}$/;
const INFO_HASH_BASE32 = /^[A-Z2-7a-z]{32}$/;
const TRAILING_SLASHES = /\/+$/;
const COMMA_SEPARATOR = /\s*,\s*/;
const IMPORT_SEASON_EPISODE_PATTERN =
  /^S?(\d{1,2})\s*E(\d{1,3})(?:\s*[-–]\s*E?(\d{1,3}))?$/i;
const IMPORT_X_EPISODE_PATTERN =
  /^(\d{1,2})x(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/i;
const IMPORT_ABSOLUTE_EPISODE_PATTERN =
  /^E(\d{1,5})(?:\s*[-–]\s*E?(\d{1,5}))?$/i;
const IMPORT_SEASON_PATTERN = /^S?(\d{1,2})$/i;
const HOST_RESOLUTION_FAILURE =
  /ENOTFOUND|getaddrinfo|Name or service not known/i;
const TIMEOUT_FAILURE = /aborted|timeout/i;
const GENERIC_FETCH_FAILURE = /^fetch failed$/i;
const CONNECT_FAILURE = /ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT/i;
const BITMAGNET_IMPORT_BATCH_FAILURE = /one or more items failed to import/i;
const CATALOG_TIMEOUT_MS = 45_000;
const CATALOG_FETCH_LIMIT = 100;
const BITMAGNET_IMPORT_TIMEOUT_MS = 90_000;
const QBITTORRENT_ADD_TIMEOUT_MS = 30_000;
const TMDB_READINESS_TIMEOUT_MS = 8000;
const TMDB_READINESS_CACHE_MS = 10 * 60 * 1000;
const submittedTorrentNames = new Map<string, string>();
let tmdbReadinessCache:
  | {
      apiKey: string;
      checkedAt: number;
      result: DownstreamResult;
    }
  | undefined;
const HISTORY_QUERY = `
query MagnetronSubmissions($input: TorrentContentSearchQueryInput!) {
  torrentContent {
    search(input: $input) {
      items {
        id
        infoHash
        contentType
        contentSource
        contentId
        title
        publishedAt
        createdAt
        updatedAt
        seeders
        leechers
        videoResolution
        videoSource
        videoCodec
        video3d
        videoModifier
        releaseGroup
        languages {
          id
          name
        }
        episodes {
          label
        }
        torrent {
          name
          magnetUri
          sources {
            key
            name
            importId
            seeders
            leechers
          }
        }
        content {
          type
          source
          id
          title
          releaseYear
          metadataSource {
            key
            name
          }
        }
      }
    }
  }
}`;

const QUEUE_QUERY = `
query MagnetronQueue($input: QueueJobsQueryInput!) {
  queue {
    jobs(input: $input) {
      items {
        id
        queue
        status
        payload
        priority
        runAfter
        error
        createdAt
      }
    }
  }
}`;

interface ParsedMagnet {
  infoHash: string;
  magnet: string;
  name: string;
}

interface BitmagnetPayload {
  content?: {
    type?: unknown;
    source?: unknown;
    id?: unknown;
    title?: unknown;
    releaseYear?: unknown;
    metadataSource?: {
      key?: unknown;
      name?: unknown;
    } | null;
  } | null;
  contentId?: unknown;
  contentSource?: unknown;
  contentType?: unknown;
  createdAt?: unknown;
  episodes?: { label?: unknown } | null;
  infoHash?: unknown;
  languages?: Array<{ id?: unknown; name?: unknown }> | null;
  leechers?: unknown;
  publishedAt?: unknown;
  releaseGroup?: unknown;
  seeders?: unknown;
  title?: unknown;
  torrent?: {
    name?: unknown;
    magnetUri?: unknown;
  } | null;
  updatedAt?: unknown;
  video3d?: unknown;
  videoCodec?: unknown;
  videoModifier?: unknown;
  videoResolution?: unknown;
  videoSource?: unknown;
}

interface QueuePayload {
  createdAt?: unknown;
  error?: unknown;
  id?: unknown;
  payload?: unknown;
  priority?: unknown;
  queue?: unknown;
  runAfter?: unknown;
  status?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const numberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const appSettings = () => ({
  bitmagnetUrl: env.BITMAGNET_URL.replace(TRAILING_SLASHES, ""),
  bitmagnetSource: env.BITMAGNET_SOURCE,
  qbittorrentUrl: env.QBITTORRENT_URL.replace(TRAILING_SLASHES, ""),
  qbittorrentApiKey: env.QBITTORRENT_API_KEY,
  qbittorrentCategory: env.QBITTORRENT_CATEGORY,
  qbittorrentTags: env.QBITTORRENT_TAGS,
  tmdbApiKey: env.TMDB_API_KEY,
  defaultAction: env.DEFAULT_ACTION,
  appVersion: env.MAGNETRON_VERSION ?? packageJson.version,
});

export function getSettings() {
  const settings = appSettings();

  return {
    bitmagnetUrl: settings.bitmagnetUrl,
    bitmagnetSource: settings.bitmagnetSource,
    qbittorrentUrl: settings.qbittorrentUrl,
    qbittorrentCategory: settings.qbittorrentCategory,
    qbittorrentTags: settings.qbittorrentTags,
    tmdbConfigured: Boolean(settings.tmdbApiKey),
    qbittorrentApiKeyConfigured: Boolean(settings.qbittorrentApiKey),
    defaultAction: settings.defaultAction,
    appVersion: settings.appVersion,
  };
}

export async function getReadiness() {
  const settings = appSettings();
  const [bitmagnet, qbittorrent, tmdb] = await Promise.all([
    fetchResult(`${settings.bitmagnetUrl}/status`, { method: "GET" }, 5000),
    fetchResult(
      `${settings.qbittorrentUrl}/api/v2/app/version`,
      {
        method: "GET",
        headers: qbitHeaders(settings.qbittorrentApiKey),
      },
      5000
    ),
    getTmdbReadiness(settings),
  ]);

  return {
    checkedAt: new Date().toISOString(),
    bitmagnet: normalizeServiceResult(bitmagnet, "bitmagnet"),
    qbittorrent,
    tmdb,
  };
}

export async function submitIntake(input: IntakeInput) {
  const settings = appSettings();
  const parsed = parseMagnet(input.magnet);
  const bitmagnet =
    input.action === "index" || input.action === "both"
      ? await importToBitmagnetWithRetry(settings, parsed, input)
      : null;
  const qbittorrent =
    input.action === "download" || input.action === "both"
      ? await sendToQbittorrent(settings, parsed)
      : null;

  const downstreamResults = [
    { label: "bitmagnet", result: bitmagnet },
    { label: "qBittorrent", result: qbittorrent },
  ].filter(
    (entry): entry is { label: string; result: DownstreamResult } =>
      entry.result !== null
  );
  const failed = downstreamResults.find((entry) => !entry.result.ok);

  if (failed) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: `${failed.label} submission failed. ${
        failed.result.message || "Downstream submission failed."
      }`,
    });
  }

  if (bitmagnet?.ok) {
    rememberSubmittedTorrent(parsed, input);
  }

  return {
    infoHash: parsed.infoHash,
    name: parsed.name,
    bitmagnet,
    qbittorrent,
    message: "Submitted. Refreshing catalog from bitmagnet.",
  };
}

export async function getCatalog(limit = 20, page = 1): Promise<CatalogResult> {
  const settings = appSettings();
  const pageSize = Math.max(1, Math.min(limit, CATALOG_FETCH_LIMIT));
  const currentPage = Math.max(1, page);

  try {
    const [payload, queuedItems] = await Promise.all([
      fetchJson<{
        errors?: Array<{ message?: string }>;
        data?: {
          torrentContent?: {
            search?: {
              hasNextPage?: boolean;
              items?: BitmagnetPayload[];
              totalCount?: number;
            };
          };
        };
      }>(
        `${settings.bitmagnetUrl}/graphql`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: HISTORY_QUERY,
            variables: {
              input: {
                limit: CATALOG_FETCH_LIMIT,
                page: 1,
                hasNextPage: true,
                totalCount: true,
                facets: {
                  torrentSource: { filter: [settings.bitmagnetSource] },
                },
                orderBy: [
                  { field: "published_at", descending: true },
                  { field: "updated_at", descending: true },
                ],
              },
            },
          }),
        },
        CATALOG_TIMEOUT_MS
      ),
      getQueuedCatalogItems(settings),
    ]);

    if (payload.errors?.length) {
      throw new Error(
        payload.errors[0]?.message ?? "bitmagnet GraphQL query failed."
      );
    }

    const rawItems = payload.data?.torrentContent?.search?.items ?? [];
    const totalCount =
      payload.data?.torrentContent?.search?.totalCount ?? rawItems.length;
    const hasNextPage = Boolean(
      payload.data?.torrentContent?.search?.hasNextPage
    );
    const seen = new Set<string>();
    const catalogItems = rawItems
      .map(historyItemFromBitmagnet)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .filter((item) => {
        const key = item.infoHash.toUpperCase();
        if (!key || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    const visibleQueuedItems = await enrichQueuedItemsFromQbittorrent(
      settings,
      queuedItems.filter((item) => !seen.has(item.infoHash.toUpperCase()))
    );
    const allItems = [...catalogItems, ...visibleQueuedItems].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
    const combinedTotal = totalCount + visibleQueuedItems.length;
    const start = (currentPage - 1) * pageSize;
    const items = allItems.slice(start, start + pageSize);
    const hasMoreCombinedItems = start + pageSize < allItems.length;

    return {
      status: "connected",
      message: `Showing ${catalogItems.length} catalog item${catalogItems.length === 1 ? "" : "s"} and ${visibleQueuedItems.length} queued import${visibleQueuedItems.length === 1 ? "" : "s"} from bitmagnet.`,
      catalogTotal: totalCount,
      checkedAt: new Date().toISOString(),
      hasNextPage: hasNextPage || hasMoreCombinedItems,
      items,
      page: currentPage,
      pageSize,
      queuedCount: visibleQueuedItems.length,
      totalCount: combinedTotal,
    };
  } catch (error) {
    return {
      status: "unavailable",
      catalogTotal: 0,
      message: formatBitmagnetCatalogError(error),
      checkedAt: new Date().toISOString(),
      hasNextPage: false,
      items: [],
      page: currentPage,
      pageSize,
      queuedCount: 0,
      totalCount: 0,
    };
  }
}

export async function searchTmdb(
  query: string,
  contentType: string
): Promise<TmdbResult[]> {
  const settings = appSettings();
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }
  if (!settings.tmdbApiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "TMDB_API_KEY is not configured.",
    });
  }

  let endpoint = "multi";
  if (contentType === "movie") {
    endpoint = "movie";
  } else if (contentType === "tv_show") {
    endpoint = "tv";
  }
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set("query", trimmed);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("page", "1");

  const headers = new Headers({ accept: "application/json" });
  if (settings.tmdbApiKey.startsWith("eyJ")) {
    headers.set("authorization", `Bearer ${settings.tmdbApiKey}`);
  } else {
    url.searchParams.set("api_key", settings.tmdbApiKey);
  }

  const payload = await fetchJson<{ results?: Record<string, unknown>[] }>(
    url.toString(),
    { headers },
    8000
  );

  return (payload.results ?? [])
    .map((result) => {
      const mediaType =
        text(result.media_type) || (endpoint === "tv" ? "tv" : "movie");
      if (mediaType !== "movie" && mediaType !== "tv") {
        return null;
      }
      const title = text(result.title) || text(result.name);
      if (!title) {
        return null;
      }
      const date = text(result.release_date) || text(result.first_air_date);
      return {
        id: String(result.id ?? ""),
        title,
        contentType: mediaType === "movie" ? "movie" : "tv_show",
        releaseYear: date.length >= 4 ? date.slice(0, 4) : "",
        overview: text(result.overview).slice(0, 180),
      } satisfies TmdbResult;
    })
    .filter((result): result is TmdbResult => Boolean(result))
    .slice(0, 8);
}

function historyItemFromBitmagnet(item: BitmagnetPayload): CatalogItem {
  const torrent = item.torrent ?? {};
  const content = item.content ?? {};
  const metadataSource = content.metadataSource ?? {};
  const contentSource = text(item.contentSource) || text(content.source);
  const contentId = text(item.contentId) || text(content.id);
  const contentType = normalizeContentType(
    text(item.contentType) || text(content.type)
  );
  const videoSummary = [
    item.videoResolution,
    item.videoSource,
    item.videoCodec,
    item.videoModifier,
    item.releaseGroup,
  ]
    .map(text)
    .filter(Boolean)
    .join(" ");
  const languages = (item.languages ?? [])
    .map((language) => text(language.id) || text(language.name))
    .filter(Boolean)
    .join(", ");

  return {
    timestamp:
      text(item.publishedAt) || text(item.updatedAt) || text(item.createdAt),
    action: "indexed",
    contentType,
    contentSource,
    contentId,
    magnet: text(torrent.magnetUri),
    infoHash: text(item.infoHash).toUpperCase(),
    name: text(torrent.name) || text(item.title) || text(content.title),
    discoveredTitle: text(content.title) || text(item.title),
    discoveredSource:
      text(metadataSource.name) || text(metadataSource.key) || contentSource,
    discoveredId: contentId,
    releaseYear: String(content.releaseYear ?? ""),
    videoSummary,
    episodes: text(item.episodes?.label),
    languages,
    videoResolution: text(item.videoResolution),
    videoSource: text(item.videoSource),
    videoCodec: text(item.videoCodec),
    videoModifier: text(item.videoModifier),
    releaseGroup: text(item.releaseGroup),
    seeders: numberOrNull(item.seeders),
    leechers: numberOrNull(item.leechers),
    bitmagnet: {
      ok: true,
      status: 200,
      message: "Found in bitmagnet catalog.",
    },
    qbittorrent: null,
    source: "bitmagnet",
  };
}

async function getQueuedCatalogItems(
  settings: ReturnType<typeof appSettings>
): Promise<CatalogItem[]> {
  try {
    const payload = await fetchJson<{
      errors?: Array<{ message?: string }>;
      data?: {
        queue?: {
          jobs?: {
            items?: QueuePayload[];
          };
        };
      };
    }>(
      `${settings.bitmagnetUrl}/graphql`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: QUEUE_QUERY,
          variables: {
            input: {
              limit: 100,
              page: 1,
              totalCount: false,
              queues: ["process_torrent"],
              statuses: ["pending", "retry", "failed"],
              orderBy: [
                { field: "priority", descending: true },
                { field: "created_at", descending: true },
              ],
            },
          },
        }),
      },
      CATALOG_TIMEOUT_MS
    );

    if (payload.errors?.length) {
      return [];
    }

    return (payload.data?.queue?.jobs?.items ?? [])
      .filter((job) => numberOrNull(job.priority) === 20)
      .flatMap(queueCatalogItemsFromJob);
  } catch {
    return [];
  }
}

function queueCatalogItemsFromJob(job: QueuePayload): CatalogItem[] {
  const infoHashes = parseQueueInfoHashes(text(job.payload));
  return infoHashes.map((infoHash) => {
    const normalizedInfoHash = infoHash.toUpperCase();
    const status = text(job.status);
    const error = text(job.error);
    const submittedName = submittedTorrentNames.get(normalizedInfoHash);

    return {
      timestamp: text(job.createdAt),
      action: "queued",
      contentType: "",
      contentSource: "",
      contentId: "",
      magnet: "",
      infoHash: normalizedInfoHash,
      name: submittedName || "",
      discoveredTitle: "",
      discoveredSource: "",
      discoveredId: "",
      releaseYear: "",
      videoSummary: "",
      episodes: "",
      languages: "",
      videoResolution: "",
      videoSource: "",
      videoCodec: "",
      videoModifier: "",
      releaseGroup: "",
      seeders: null,
      leechers: null,
      bitmagnet: {
        ok: status !== "failed",
        status: null,
        message: error || `bitmagnet queue status: ${status || "pending"}.`,
      },
      qbittorrent: null,
      queue: {
        id: text(job.id),
        queue: text(job.queue),
        status,
        priority: numberOrNull(job.priority),
        runAfter: text(job.runAfter),
        error,
      },
      source: "bitmagnet",
    };
  });
}

async function enrichQueuedItemsFromQbittorrent(
  settings: ReturnType<typeof appSettings>,
  items: CatalogItem[]
) {
  if (!(settings.qbittorrentApiKey && items.length)) {
    return items;
  }

  const hashes = items.map((item) => item.infoHash.toLowerCase()).join("|");
  try {
    const torrents = await fetchJson<Array<{ hash?: unknown; name?: unknown }>>(
      `${settings.qbittorrentUrl}/api/v2/torrents/info?hashes=${encodeURIComponent(hashes)}`,
      { headers: qbitHeaders(settings.qbittorrentApiKey) },
      5000
    );
    const names = new Map(
      torrents
        .map((torrent) => [
          text(torrent.hash).toUpperCase(),
          text(torrent.name),
        ])
        .filter((entry): entry is [string, string] =>
          Boolean(entry[0] && entry[1])
        )
    );
    return items.map((item) => ({
      ...item,
      name: item.name || names.get(item.infoHash.toUpperCase()) || "",
    }));
  } catch {
    return items;
  }
}

function rememberSubmittedTorrent(parsed: ParsedMagnet, input: IntakeInput) {
  const name = parsed.name || input.title;
  if (!name) {
    return;
  }
  submittedTorrentNames.set(parsed.infoHash.toUpperCase(), name);
  if (submittedTorrentNames.size > 200) {
    const oldestKey = submittedTorrentNames.keys().next().value;
    if (oldestKey) {
      submittedTorrentNames.delete(oldestKey);
    }
  }
}

function parseQueueInfoHashes(payload: string) {
  if (!payload) {
    return [];
  }

  try {
    const parsed = JSON.parse(payload) as { InfoHashes?: unknown };
    if (!Array.isArray(parsed.InfoHashes)) {
      return [];
    }
    return parsed.InfoHashes.filter(
      (value): value is string =>
        typeof value === "string" && INFO_HASH_HEX.test(value)
    );
  } catch {
    return [];
  }
}

function parseMagnet(value: string): ParsedMagnet {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Input must be a magnet link.",
    });
  }
  if (url.protocol !== "magnet:") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Input must be a magnet link.",
    });
  }

  const xt = url.searchParams
    .getAll("xt")
    .find((candidate) => candidate.toLowerCase().startsWith("urn:btih:"));
  if (!xt) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Magnet link does not include xt=urn:btih.",
    });
  }

  return {
    magnet: value.trim(),
    infoHash: normalizeInfoHash(xt.split(":").at(-1) ?? ""),
    name: url.searchParams.get("dn")?.trim() ?? "",
  };
}

function normalizeInfoHash(value: string) {
  if (INFO_HASH_HEX.test(value)) {
    return value.toUpperCase();
  }
  if (INFO_HASH_BASE32.test(value)) {
    return base32ToHex(value);
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: "Magnet xt must contain a v1 btih hash in hex or base32 form.",
  });
}

function base32ToHex(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid base32 info hash.",
      });
    }
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes).toString("hex").toUpperCase();
}

async function importToBitmagnetWithRetry(
  settings: ReturnType<typeof appSettings>,
  parsed: ParsedMagnet,
  input: IntakeInput
) {
  const firstAttempt = await importToBitmagnet(settings, parsed, input);
  if (firstAttempt.ok || !isBitmagnetImportBatchFailure(firstAttempt.message)) {
    return firstAttempt;
  }

  const existing = await getCatalogItemByInfoHash(settings, parsed.infoHash);
  if (existing?.source === "bitmagnet") {
    return {
      ...firstAttempt,
      ok: true,
      status: 202,
      message:
        "Accepted by bitmagnet earlier and still awaiting processing. The catalog row will update after bitmagnet finishes processing it.",
    };
  }

  const queued = await getQueuedCatalogItemByInfoHash(
    settings,
    parsed.infoHash
  );
  if (queued) {
    return {
      ...firstAttempt,
      ok: true,
      status: 202,
      message:
        "Already accepted by bitmagnet and currently queued for processing.",
    };
  }

  return firstAttempt;
}

function importToBitmagnet(
  settings: ReturnType<typeof appSettings>,
  parsed: ParsedMagnet,
  input: IntakeInput
) {
  const record: Record<string, unknown> = {
    source: settings.bitmagnetSource,
    infoHash: parsed.infoHash,
    size: 0,
    publishedAt: new Date().toISOString(),
  };
  if (input.contentType !== "unknown") {
    record.contentType = input.contentType;
  }
  if (input.contentSource && input.contentId) {
    record.contentSource = input.contentSource;
    record.contentId = input.contentId;
  }
  if (parsed.name) {
    record.name = parsed.name;
  }
  if (input.title) {
    record.title = input.title;
  }
  if (input.releaseYear) {
    record.releaseYear = Number.parseInt(input.releaseYear, 10);
  }
  if (input.episodes) {
    const episodes = parseEpisodesInput(input.episodes);
    if (episodes) {
      record.episodes = episodes;
    }
  }
  if (input.languages) {
    record.languages = parseLanguagesInput(input.languages);
  }
  if (input.videoResolution) {
    record.videoResolution = input.videoResolution;
  }
  if (input.videoSource) {
    record.videoSource = input.videoSource;
  }
  if (input.videoCodec) {
    record.videoCodec = input.videoCodec;
  }
  if (input.videoModifier) {
    record.videoModifier = input.videoModifier;
  }
  if (input.releaseGroup) {
    record.releaseGroup = input.releaseGroup;
  }

  return fetchResult(
    `${settings.bitmagnetUrl}/import`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "close",
        "x-import-id": `magnetron-${settings.bitmagnetSource}`,
      },
      body: `${JSON.stringify(record)}\n`,
    },
    BITMAGNET_IMPORT_TIMEOUT_MS
  );
}

async function getCatalogItemByInfoHash(
  settings: ReturnType<typeof appSettings>,
  infoHash: string
) {
  try {
    const payload = await fetchJson<{
      errors?: Array<{ message?: string }>;
      data?: {
        torrentContent?: {
          search?: {
            items?: BitmagnetPayload[];
          };
        };
      };
    }>(
      `${settings.bitmagnetUrl}/graphql`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: HISTORY_QUERY,
          variables: {
            input: {
              limit: 1,
              page: 1,
              totalCount: false,
              infoHashes: [infoHash.toLowerCase()],
            },
          },
        }),
      },
      CATALOG_TIMEOUT_MS
    );

    if (payload.errors?.length) {
      return null;
    }
    const item = payload.data?.torrentContent?.search?.items?.[0];
    return item ? historyItemFromBitmagnet(item) : null;
  } catch {
    return null;
  }
}

async function getQueuedCatalogItemByInfoHash(
  settings: ReturnType<typeof appSettings>,
  infoHash: string
) {
  try {
    const queuedItems = await getQueuedCatalogItems(settings);
    const normalizedInfoHash = infoHash.toUpperCase();
    return (
      queuedItems.find((item) => item.infoHash === normalizedInfoHash) ?? null
    );
  } catch {
    return null;
  }
}

function parseEpisodesInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const result: Record<string, Record<string, Record<string, never>>> = {};
  for (const rawPart of trimmed.split(COMMA_SEPARATOR)) {
    const part = rawPart.trim();
    if (part) {
      applyEpisodePart(result, part);
    }
  }

  return Object.keys(result).length ? result : null;
}

function parseLanguagesInput(value: string) {
  return value
    .split(COMMA_SEPARATOR)
    .map((language) => language.trim().toLowerCase())
    .filter(Boolean);
}

function applyEpisodePart(
  result: Record<string, Record<string, Record<string, never>>>,
  part: string
) {
  const episodeMatch =
    part.match(IMPORT_SEASON_EPISODE_PATTERN) ??
    part.match(IMPORT_X_EPISODE_PATTERN);
  if (episodeMatch) {
    addEpisodeRange(result, episodeMatch);
    return;
  }

  const absoluteEpisode = part.match(IMPORT_ABSOLUTE_EPISODE_PATTERN);
  if (absoluteEpisode) {
    addAbsoluteEpisodeRange(result, absoluteEpisode);
    return;
  }

  const seasonOnly = part.match(IMPORT_SEASON_PATTERN);
  if (seasonOnly) {
    addSeason(result, Number.parseInt(seasonOnly[1] ?? "", 10));
  }
}

function addAbsoluteEpisodeRange(
  result: Record<string, Record<string, Record<string, never>>>,
  match: RegExpMatchArray
) {
  const first = Number.parseInt(match[1] ?? "", 10);
  const last = Number.parseInt(match[2] ?? "", 10);
  if (Number.isFinite(last) && last >= first) {
    for (let episode = first; episode <= last; episode++) {
      addEpisode(result, 0, episode);
    }
    return;
  }
  addEpisode(result, 0, first);
}

function addSeason(
  result: Record<string, Record<string, Record<string, never>>>,
  season: number
) {
  if (Number.isInteger(season) && season >= 0) {
    result[String(season)] = {};
  }
}

function addEpisodeRange(
  result: Record<string, Record<string, Record<string, never>>>,
  match: RegExpMatchArray
) {
  const season = Number.parseInt(match[1] ?? "", 10);
  const first = Number.parseInt(match[2] ?? "", 10);
  const last = Number.parseInt(match[3] ?? "", 10);
  if (Number.isFinite(last) && last >= first) {
    for (let episode = first; episode <= last; episode++) {
      addEpisode(result, season, episode);
    }
    return;
  }
  addEpisode(result, season, first);
}

function addEpisode(
  result: Record<string, Record<string, Record<string, never>>>,
  season: number,
  episode: number
) {
  if (
    !(Number.isInteger(season) && Number.isInteger(episode)) ||
    season < 0 ||
    episode < 0
  ) {
    return;
  }
  const seasonKey = String(season);
  const seasonEpisodes = result[seasonKey] ?? {};
  seasonEpisodes[String(episode)] = {};
  result[seasonKey] = seasonEpisodes;
}

function sendToQbittorrent(
  settings: ReturnType<typeof appSettings>,
  parsed: ParsedMagnet
) {
  if (!settings.qbittorrentApiKey) {
    return Promise.resolve({
      ok: false,
      status: null,
      message: "QBITTORRENT_API_KEY is not configured.",
    });
  }

  const body = new URLSearchParams({
    urls: parsed.magnet,
    category: settings.qbittorrentCategory,
    tags: settings.qbittorrentTags,
  });

  return fetchResult(
    `${settings.qbittorrentUrl}/api/v2/torrents/add`,
    {
      method: "POST",
      headers: {
        ...qbitHeaders(settings.qbittorrentApiKey),
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
    QBITTORRENT_ADD_TIMEOUT_MS
  );
}

function qbitHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

async function fetchResult(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<DownstreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    assertHttpUrl(url);
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      message: body.trim().slice(0, 400) || response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: formatNetworkError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getTmdbReadiness(
  settings: ReturnType<typeof appSettings>
): Promise<DownstreamResult> {
  if (!settings.tmdbApiKey) {
    return {
      ok: false,
      status: null,
      message: "TMDB_API_KEY is not configured.",
      health: "down",
    };
  }

  const now = Date.now();
  if (
    tmdbReadinessCache?.apiKey === settings.tmdbApiKey &&
    now - tmdbReadinessCache.checkedAt < TMDB_READINESS_CACHE_MS
  ) {
    return {
      ...tmdbReadinessCache.result,
      message: `${tmdbReadinessCache.result.message} Cached for up to 10 minutes.`,
    };
  }

  const url = new URL("https://api.themoviedb.org/3/configuration");
  const headers = new Headers({ accept: "application/json" });
  if (settings.tmdbApiKey.startsWith("eyJ")) {
    headers.set("authorization", `Bearer ${settings.tmdbApiKey}`);
  } else {
    url.searchParams.set("api_key", settings.tmdbApiKey);
  }

  const result = normalizeTmdbReadiness(
    await fetchResult(
      url.toString(),
      { headers, method: "GET" },
      TMDB_READINESS_TIMEOUT_MS
    )
  );
  tmdbReadinessCache = {
    apiKey: settings.tmdbApiKey,
    checkedAt: now,
    result,
  };
  return result;
}

function normalizeTmdbReadiness(result: DownstreamResult): DownstreamResult {
  if (result.ok) {
    return {
      ...result,
      health: "up",
      message: "TMDB API reachable.",
    };
  }
  if (result.status === 429) {
    return {
      ...result,
      health: "degraded",
      message: "TMDB API rate-limited this check. Waiting before retrying.",
    };
  }
  return {
    ...result,
    health: "down",
    message: isGenericFetchFailure(result.message)
      ? "Unable to reach TMDB API from Magnetron."
      : result.message,
  };
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    assertHttpUrl(url);
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(body.trim() || response.statusText);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function assertHttpUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported.");
  }
}

function normalizeContentType(value: string) {
  return contentTypes.includes(value as (typeof contentTypes)[number])
    ? value
    : "unknown";
}

function formatBitmagnetCatalogError(error: unknown) {
  const reason = formatNetworkError(error);
  if (TIMEOUT_FAILURE.test(reason)) {
    return "Catalog query timed out. bitmagnet health can still be up while GraphQL search is busy or waiting on storage.";
  }
  if (isGenericFetchFailure(reason)) {
    return "Catalog query failed. bitmagnet health can still be up while GraphQL search is unavailable.";
  }
  if (HOST_RESOLUTION_FAILURE.test(reason)) {
    return "Catalog query failed because the bitmagnet host could not be resolved.";
  }
  return reason ? `Catalog query failed. ${reason}` : "Catalog query failed.";
}

function formatNetworkError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return "Request timed out.";
    }
    return error.message;
  }
  return String(error);
}

function normalizeServiceResult(
  result: DownstreamResult,
  service: "bitmagnet" | "qbittorrent"
) {
  if (service === "bitmagnet") {
    const health = summarizeBitmagnetHealth(result.message);
    if (health.message) {
      return {
        ...result,
        health: health.status,
        ok: health.status !== "down",
        message:
          health.status === "degraded"
            ? `${health.message}. Magnetron can reach bitmagnet, but bitmagnet reports degraded dependencies.`
            : health.message,
      };
    }
    if (result.message.trim().startsWith("{")) {
      return {
        ...result,
        message: "bitmagnet returned an unreadable health payload.",
      };
    }
  }
  if (result.ok) {
    return result;
  }
  const name = service === "bitmagnet" ? "bitmagnet" : "qBittorrent";
  if (isGenericFetchFailure(result.message)) {
    return {
      ...result,
      message: `Unable to reach ${name}. Check ${service === "bitmagnet" ? "BITMAGNET_URL" : "QBITTORRENT_URL"} or network access.`,
    };
  }
  return result;
}

function summarizeBitmagnetHealth(rawMessage: string) {
  try {
    const payload = JSON.parse(rawMessage) as {
      info?: { version?: unknown };
      status?: unknown;
      details?: Record<string, { status?: unknown; error?: unknown }>;
    };
    const status = text(payload.status) || "unknown";
    const version = text(payload.info?.version);
    const detailsPayload = payload.details ?? {};
    const postgresStatus = text(detailsPayload.postgres?.status);
    const dhtStatus = text(detailsPayload.dht?.status);
    let healthStatus: "up" | "degraded" | "down" = "down";
    if (status === "up") {
      healthStatus = "up";
    } else if (postgresStatus === "up" || dhtStatus === "up") {
      healthStatus = "degraded";
    }
    const details = Object.entries(payload.details ?? {}).map(
      ([key, value]) => {
        const detailStatus = text(value.status) || "unknown";
        const error = text(value.error);
        return `${key} ${detailStatus}${error ? ` (${error})` : ""}`;
      }
    );

    const summary = [
      `bitmagnet${version ? ` ${version}` : ""}: ${status}`,
      details.length ? details.join("; ") : "",
    ]
      .filter(Boolean)
      .join(". ");

    return { message: summary, status: healthStatus } as const;
  } catch {
    return { message: "", status: "down" } as const;
  }
}

function isGenericFetchFailure(reason: string) {
  return (
    GENERIC_FETCH_FAILURE.test(reason.trim()) || CONNECT_FAILURE.test(reason)
  );
}

function isBitmagnetImportBatchFailure(message: string) {
  return BITMAGNET_IMPORT_BATCH_FAILURE.test(message);
}
