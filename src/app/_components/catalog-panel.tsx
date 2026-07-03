import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
} from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import { type CatalogItem, contentTypeLabels } from "~/lib/magnetron";

type CatalogFilter = "all" | "processed" | "pending";

const catalogSkeletonKeys = [
  "catalog-skeleton-1",
  "catalog-skeleton-2",
  "catalog-skeleton-3",
  "catalog-skeleton-4",
  "catalog-skeleton-5",
  "catalog-skeleton-6",
  "catalog-skeleton-7",
  "catalog-skeleton-8",
];

export function CatalogPanel({
  loading,
  fetching,
  page,
  result,
  onPageChange,
  onEdit,
}: {
  loading: boolean;
  fetching: boolean;
  page: number;
  result?: {
    catalogTotal: number;
    status: "connected" | "unavailable";
    message: string;
    checkedAt: string;
    hasNextPage: boolean;
    items: CatalogItem[];
    queuedCount: number;
    totalCount: number;
  };
  onPageChange: (page: number) => void;
  onEdit: (item: CatalogItem) => void;
}) {
  const [filter, setFilter] = useCatalogFilter();
  const filteredItems = (result?.items ?? []).filter((item) =>
    matchesCatalogFilter(item, filter)
  );

  let catalogContent = (
    <Empty className="min-h-72 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Search className="size-4" />
        </EmptyMedia>
        <EmptyTitle>
          {result?.status === "unavailable"
            ? "Nothing shown while catalog is unavailable"
            : "No catalog entries yet"}
        </EmptyTitle>
        <EmptyDescription>
          Successful submissions are shown only after they can be read back from
          bitmagnet.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  if (loading) {
    catalogContent = (
      <div className="space-y-3">
        {catalogSkeletonKeys.map((key) => (
          <Skeleton className="h-24 rounded-lg" key={key} />
        ))}
      </div>
    );
  } else if (result?.items.length && filteredItems.length === 0) {
    catalogContent = (
      <Empty className="min-h-72 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Search className="size-4" />
          </EmptyMedia>
          <EmptyTitle>No matching catalog entries</EmptyTitle>
          <EmptyDescription>
            Change the status filter to see the rest of this bitmagnet readback.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (filteredItems.length) {
    catalogContent = (
      <div className="rounded-lg border border-border/70 bg-background/35">
        <div className="divide-y divide-border/70">
          {filteredItems.map((item) => (
            <CatalogRow item={item} key={item.infoHash} onEdit={onEdit} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="rounded-lg border-border/70 bg-card/88 shadow-[0_24px_80px_oklch(0_0_0/0.18)]">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Catalog</CardTitle>
          <CardDescription>
            Recent bitmagnet GraphQL readback, deduped by info hash.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
              size="icon"
              type="button"
              variant="outline"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Badge className="min-w-16 justify-center" variant="outline">
              Page {page}
            </Badge>
            <Button
              disabled={!result?.hasNextPage}
              onClick={() => onPageChange(page + 1)}
              size="icon"
              type="button"
              variant="outline"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <Select
            onValueChange={(value) => setFilter(value as CatalogFilter)}
            value={filter}
          >
            <SelectTrigger aria-label="Catalog status filter" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="pending">Awaiting processing</SelectItem>
            </SelectContent>
          </Select>
          <Badge
            variant={
              result?.status === "connected" ? "secondary" : "destructive"
            }
          >
            {fetching && <Loader2 className="size-3 animate-spin" />}
            {result?.status === "connected" ? "GraphQL OK" : "Unavailable"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {result?.status === "connected" && (
          <div className="text-muted-foreground text-xs">
            Showing {filteredItems.length} visible, {result.catalogTotal} in
            catalog, {result.queuedCount} queued.
          </div>
        )}

        {result?.status === "unavailable" && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Catalog unavailable</AlertTitle>
            <AlertDescription>{result.message}</AlertDescription>
          </Alert>
        )}

        {catalogContent}
      </CardContent>
    </Card>
  );
}

function useCatalogFilter() {
  const [filter, setFilter] = useState<CatalogFilter>("all");
  return [filter, setFilter] as const;
}

function matchesCatalogFilter(item: CatalogItem, filter: CatalogFilter) {
  if (filter === "all") {
    return true;
  }
  const processed = hasProcessedContent(item);
  return filter === "processed" ? processed : !processed;
}

function hasProcessedContent(item: CatalogItem) {
  const resolvedContentSource = item.discoveredSource || item.contentSource;
  const resolvedContentId = item.discoveredId || item.contentId;
  return Boolean(resolvedContentSource && resolvedContentId);
}

function CatalogRow({
  item,
  onEdit,
}: {
  item: CatalogItem;
  onEdit: (item: CatalogItem) => void;
}) {
  const title =
    item.discoveredTitle ||
    item.name ||
    (item.queue ? "Queued, name unavailable" : "(unnamed)");
  const resolvedContentSource = item.discoveredSource || item.contentSource;
  const resolvedContentId = item.discoveredId || item.contentId;
  const processed = hasProcessedContent(item);
  const queued = Boolean(item.queue);
  const statusLabel =
    getCatalogStatusLabel(item, processed) || "Awaiting processing";

  return (
    <div className="grid gap-3 p-4 transition-colors duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-muted/45 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={queued ? "secondary" : "outline"}>
            {queued ? "In queue" : "In catalog"}
          </Badge>
          <Badge variant={getCatalogStatusVariant(item, processed)}>
            {statusLabel}
          </Badge>
          <QueuePriorityBadge item={item} />
          {item.contentType && (
            <Badge variant="secondary">
              {contentTypeLabels[
                item.contentType as keyof typeof contentTypeLabels
              ] ?? item.contentType}
            </Badge>
          )}
          {item.releaseYear && (
            <Badge variant="secondary">{item.releaseYear}</Badge>
          )}
          {item.episodes && <Badge variant="secondary">{item.episodes}</Badge>}
          {item.languages && (
            <Badge variant="secondary">{item.languages}</Badge>
          )}
          {item.videoSummary && (
            <Badge variant="secondary">{item.videoSummary}</Badge>
          )}
        </div>
        <div>
          <h3 className="truncate font-medium text-base">{title}</h3>
          <p className="mt-1 truncate font-mono text-muted-foreground text-xs [font-feature-settings:'zero'_1] [font-variant-numeric:tabular-nums]">
            {item.infoHash}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs tabular-nums">
          <span>Seeders {item.seeders ?? "n/a"}</span>
          <span>Leechers {item.leechers ?? "n/a"}</span>
          {processed && (
            <span>
              {resolvedContentSource}: {resolvedContentId}
            </span>
          )}
          {item.queue?.runAfter && <span>Run after {item.queue.runAfter}</span>}
          {item.queue?.error && <span>{item.queue.error}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 lg:justify-end">
        {item.magnet && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button asChild size="icon" type="button" variant="outline">
                <a href={item.magnet}>
                  <Download className="size-4" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open magnet</TooltipContent>
          </Tooltip>
        )}
        <Button onClick={() => onEdit(item)} type="button" variant="outline">
          Edit
        </Button>
      </div>
    </div>
  );
}

function getCatalogStatusLabel(item: CatalogItem, processed: boolean) {
  if (processed) {
    return "Processed";
  }
  return item.queue?.status;
}

function getCatalogStatusVariant(item: CatalogItem, processed: boolean) {
  return processed || item.queue?.status === "pending"
    ? "secondary"
    : "outline";
}

function QueuePriorityBadge({ item }: { item: CatalogItem }) {
  if (item.queue?.priority === null || item.queue?.priority === undefined) {
    return null;
  }
  return <Badge variant="outline">Priority {item.queue.priority}</Badge>;
}
