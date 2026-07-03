import { ChevronsUpDown, Film, Loader2 } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import { Field, FieldDescription, FieldLabel } from "~/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { contentTypeLabels } from "~/lib/magnetron";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function TmdbPicker({
  contentType,
  disabled,
  value,
  onPick,
}: {
  contentType: string;
  disabled: boolean;
  value: string;
  onPick: (result: {
    id: string;
    title: string;
    contentType: "movie" | "tv_show";
    releaseYear: string;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const deferredQuery = useDeferredValue(query);
  const search = api.magnetron.searchTmdb.useQuery(
    { query: deferredQuery, contentType },
    {
      enabled: open && !disabled && deferredQuery.trim().length >= 2,
      retry: false,
    }
  );

  useEffect(() => setQuery(value), [value]);

  return (
    <Field>
      <FieldLabel>TMDB title search</FieldLabel>
      <Popover onOpenChange={setOpen} open={open}>
        <PopoverTrigger asChild>
          <Button
            className="justify-between"
            disabled={disabled}
            role="combobox"
            type="button"
            variant="outline"
          >
            <span className={cn("truncate", !value && "text-muted-foreground")}>
              {value || "Search movie or show"}
            </span>
            <ChevronsUpDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              onValueChange={setQuery}
              placeholder="Search TMDB..."
              value={query}
            />
            <CommandList>
              {search.isFetching && (
                <div className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  Searching
                </div>
              )}
              {search.error && (
                <div className="px-3 py-3 text-destructive text-sm">
                  {search.error.message}
                </div>
              )}
              <CommandEmpty>No titles found.</CommandEmpty>
              <CommandGroup>
                {(search.data ?? []).map((result) => (
                  <CommandItem
                    className="items-start gap-3"
                    key={`${result.contentType}-${result.id}`}
                    onSelect={() => {
                      onPick(result);
                      setOpen(false);
                    }}
                    value={`${result.title} ${result.releaseYear}`}
                  >
                    <Film className="mt-1 size-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {result.title}
                        {result.releaseYear ? ` (${result.releaseYear})` : ""}
                      </div>
                      <div className="line-clamp-2 text-muted-foreground text-xs">
                        {result.overview ||
                          contentTypeLabels[result.contentType]}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <FieldDescription>
          Selected title will submit with its TMDB ID.
        </FieldDescription>
      )}
    </Field>
  );
}
