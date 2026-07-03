"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardPaste, Loader2, RefreshCw, Search, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import {
  actionLabels,
  actions,
  contentTypeLabels,
  contentTypes,
  type IntakeInput,
  inferTorrentHints,
  intakeSchema,
  videoCodecs,
  videoModifiers,
  videoResolutions,
  videoSources,
} from "~/lib/magnetron";
import { api } from "~/trpc/react";
import { CatalogPanel } from "./catalog-panel";
import { EpisodeBuilder } from "./episode-builder";
import { HintSelect } from "./hint-select";
import { LiveStatus } from "./live-status";
import { magnetDisplayName } from "./magnet-utils";
import { SettingsPanel } from "./settings-panel";
import { TmdbPicker } from "./tmdb-picker";

interface Props {
  defaultAction: IntakeInput["action"];
}

const submittedNamesStorageKey = "magnetron.submittedTorrentNames";

export function MagnetronApp({ defaultAction }: Props) {
  const utils = api.useUtils();
  const [catalogPage, setCatalogPage] = useState(1);
  const [submittedNames, setSubmittedNames] = useState<Record<string, string>>(
    {}
  );
  const settings = api.magnetron.settings.useQuery();
  const readiness = api.magnetron.readiness.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const catalog = api.magnetron.catalog.useQuery(
    { limit: 20, page: catalogPage },
    {
      refetchInterval: 60_000,
      staleTime: 30_000,
    }
  );

  useEffect(() => {
    const rawValue = window.localStorage.getItem(submittedNamesStorageKey);
    if (!rawValue) {
      return;
    }
    try {
      const parsed = JSON.parse(rawValue) as Record<string, unknown>;
      setSubmittedNames(
        Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] =>
              typeof entry[1] === "string" && Boolean(entry[1])
          )
        )
      );
    } catch {
      window.localStorage.removeItem(submittedNamesStorageKey);
    }
  }, []);

  const rememberSubmittedName = useCallback(
    (infoHash: string, name: string) => {
      if (!(infoHash && name)) {
        return;
      }
      const normalizedInfoHash = infoHash.toUpperCase();
      setSubmittedNames((current) => {
        const next = { ...current, [normalizedInfoHash]: name };
        window.localStorage.setItem(
          submittedNamesStorageKey,
          JSON.stringify(next)
        );
        return next;
      });
    },
    []
  );

  const enrichedCatalog = useMemo(() => {
    if (!catalog.data) {
      return;
    }
    return {
      ...catalog.data,
      items: catalog.data.items.map((item) => {
        const submittedName = submittedNames[item.infoHash.toUpperCase()];
        if (!(item.queue && submittedName)) {
          return item;
        }
        return { ...item, name: submittedName };
      }),
    };
  }, [catalog.data, submittedNames]);

  const form = useForm<IntakeInput>({
    resolver: zodResolver(intakeSchema),
    mode: "onBlur",
    reValidateMode: "onBlur",
    defaultValues: {
      magnet: "",
      action: defaultAction,
      contentType: "tv_show",
      contentSource: "",
      contentId: "",
      title: "",
      releaseYear: "",
      episodes: "",
      videoResolution: "",
      videoSource: "",
      videoCodec: "",
      videoModifier: "",
      languages: "",
      releaseGroup: "",
    },
  });

  const submit = api.magnetron.submit.useMutation({
    onSuccess: async (result) => {
      toast.success("Submitted", {
        description: result.message,
      });
      rememberSubmittedName(
        result.infoHash,
        result.name || form.getValues("title") || ""
      );
      setCatalogPage(1);
      form.reset({
        magnet: "",
        action: form.getValues("action"),
        contentType: form.getValues("contentType"),
        contentSource: "",
        contentId: "",
        title: "",
        releaseYear: "",
        episodes: "",
        videoResolution: "",
        videoSource: "",
        videoCodec: "",
        videoModifier: "",
        languages: "",
        releaseGroup: "",
      });
      await Promise.all([
        utils.magnetron.catalog.invalidate(),
        utils.magnetron.readiness.invalidate(),
      ]);
    },
    onError: (error) => {
      toast.error("Submission failed", { description: error.message });
    },
  });

  const selectedType = form.watch("contentType");
  const applyInferredHints = useCallback(
    (magnet: string) => {
      const name = magnetDisplayName(magnet);
      if (!name) {
        return;
      }
      const hints = inferTorrentHints(name);
      for (const [key, value] of Object.entries(hints) as [
        keyof IntakeInput,
        string | undefined,
      ][]) {
        if (!value || form.getValues(key)) {
          continue;
        }
        form.setValue(key, value, { shouldDirty: true, shouldValidate: true });
      }
    },
    [form]
  );
  const validateFields = useCallback(
    (names: Array<keyof IntakeInput>, override: Partial<IntakeInput> = {}) => {
      const result = intakeSchema.safeParse({
        ...form.getValues(),
        ...override,
      });
      for (const name of names) {
        const issue = result.success
          ? undefined
          : result.error.issues.find((candidate) => candidate.path[0] === name);
        if (issue) {
          form.setError(name, { type: "manual", message: issue.message });
        } else {
          form.clearErrors(name);
        }
      }
    },
    [form]
  );

  return (
    <main className="min-h-[100dvh] bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(180deg,oklch(0.17_0.018_255),oklch(0.105_0.012_255)_44%,oklch(0.09_0.01_255)),linear-gradient(90deg,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(0deg,oklch(1_0_0/0.035)_1px,transparent_1px)] bg-[size:auto,48px_48px,48px_48px]" />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-border/60 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="font-medium text-primary/80 text-xs uppercase tracking-[0.16em]">
              Magnetron
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="text-balance font-semibold text-2xl tracking-normal sm:text-3xl">
                Intake control
              </h1>
              <Badge className="font-mono text-[0.7rem]" variant="outline">
                v{settings.data?.appVersion ?? "dev"}
              </Badge>
            </div>
          </div>
          <LiveStatus
            loading={readiness.isLoading}
            readiness={readiness.data}
          />
        </header>

        <Tabs className="w-full" defaultValue="intake">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList className="w-full sm:w-auto">
              <TabsTrigger value="intake">Intake</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>
            <div className="flex items-center justify-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      readiness.refetch().catch(() => undefined);
                    }}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <RefreshCw className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh live status</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      catalog.refetch().catch(() => undefined);
                    }}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    <Search className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh catalog</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <TabsContent className="mt-5" value="intake">
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,27rem)_1fr]">
              <Card className="h-fit min-w-0 rounded-lg border-border/70 bg-card/88 shadow-[0_24px_80px_oklch(0_0_0/0.24)]">
                <CardHeader>
                  <CardTitle>Submit</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="flex min-w-0 flex-col gap-5"
                    onSubmit={form.handleSubmit((values) =>
                      submit.mutate(values)
                    )}
                  >
                    <FieldGroup>
                      <Controller
                        control={form.control}
                        name="magnet"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={field.name}>
                              Magnet link
                            </FieldLabel>
                            <div className="relative min-w-0">
                              <Textarea
                                {...field}
                                aria-invalid={fieldState.invalid}
                                className="max-w-full resize-none overflow-x-hidden pr-11 font-mono text-xs leading-5 [overflow-wrap:anywhere]"
                                id={field.name}
                                onBlur={() => {
                                  field.onBlur();
                                  validateFields(["magnet"]);
                                  applyInferredHints(field.value);
                                }}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  field.onChange(event);
                                  validateFields(["magnet"], {
                                    magnet: nextValue,
                                  });
                                  applyInferredHints(nextValue);
                                }}
                                placeholder="magnet:?xt=urn:btih:..."
                                rows={5}
                              />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    className="absolute top-1 right-1"
                                    onClick={() =>
                                      navigator.clipboard
                                        .readText()
                                        .then((value) =>
                                          form.setValue("magnet", value, {
                                            shouldDirty: true,
                                            shouldValidate: true,
                                          })
                                        )
                                        .then(() =>
                                          applyInferredHints(
                                            form.getValues("magnet")
                                          )
                                        )
                                        .catch(() =>
                                          toast.error(
                                            "Clipboard is unavailable"
                                          )
                                        )
                                    }
                                    size="icon"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <ClipboardPaste className="size-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Paste from clipboard
                                </TooltipContent>
                              </Tooltip>
                            </div>
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />

                      <Controller
                        control={form.control}
                        name="action"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel
                              onClick={() =>
                                document
                                  .getElementById(`action-${field.value}`)
                                  ?.focus()
                              }
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  document
                                    .getElementById(`action-${field.value}`)
                                    ?.focus();
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              Action
                            </FieldLabel>
                            <ToggleGroup
                              className="grid w-full grid-cols-3 gap-1.5"
                              onValueChange={(value) => {
                                if (value) {
                                  field.onChange(value);
                                }
                              }}
                              size="default"
                              type="single"
                              value={field.value}
                              variant="outline"
                            >
                              {actions.map((action) => (
                                <ToggleGroupItem
                                  className="h-9 w-full justify-center rounded-md border-border/70 bg-background/45 px-2 text-center text-sm data-[state=on]:border-primary/70 data-[state=on]:bg-primary/14 data-[state=on]:text-foreground"
                                  id={`action-${action}`}
                                  key={action}
                                  value={action}
                                >
                                  {actionLabels[action]}
                                </ToggleGroupItem>
                              ))}
                            </ToggleGroup>
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />

                      <Controller
                        control={form.control}
                        name="contentType"
                        render={({ field, fieldState }) => (
                          <Field data-invalid={fieldState.invalid}>
                            <FieldLabel htmlFor={field.name}>
                              Content type
                            </FieldLabel>
                            <Select
                              onValueChange={(value) => {
                                field.onChange(value);
                                if (value === "unknown") {
                                  form.setValue("contentSource", "");
                                  form.setValue("contentId", "");
                                  form.setValue("title", "");
                                }
                                validateFields([
                                  "contentType",
                                  "contentSource",
                                  "contentId",
                                ]);
                              }}
                              value={field.value}
                            >
                              <SelectTrigger
                                aria-invalid={fieldState.invalid}
                                id={field.name}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {contentTypes.map((type) => (
                                  <SelectItem key={type} value={type}>
                                    {contentTypeLabels[type]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError errors={[fieldState.error]} />
                          </Field>
                        )}
                      />

                      <TmdbPicker
                        contentType={selectedType}
                        disabled={selectedType === "unknown"}
                        onPick={(result) => {
                          form.setValue("title", result.title, {
                            shouldDirty: true,
                          });
                          form.setValue("contentType", result.contentType, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          form.setValue("contentSource", "tmdb", {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          form.setValue("contentId", result.id, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                          form.setValue("releaseYear", result.releaseYear, {
                            shouldDirty: true,
                            shouldValidate: true,
                          });
                        }}
                        value={form.watch("title") ?? ""}
                      />

                      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
                        <Controller
                          control={form.control}
                          name="contentSource"
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor={field.name}>
                                Source
                              </FieldLabel>
                              <Select
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  validateFields([
                                    "contentSource",
                                    "contentId",
                                  ]);
                                }}
                                value={field.value}
                              >
                                <SelectTrigger
                                  aria-invalid={fieldState.invalid}
                                  id={field.name}
                                >
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="">None</SelectItem>
                                  <SelectItem value="tmdb">TMDB</SelectItem>
                                </SelectContent>
                              </Select>
                              <FieldError errors={[fieldState.error]} />
                            </Field>
                          )}
                        />
                        <Controller
                          control={form.control}
                          name="contentId"
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor={field.name}>
                                Content ID
                              </FieldLabel>
                              <Input
                                {...field}
                                aria-invalid={fieldState.invalid}
                                id={field.name}
                                onBlur={() => {
                                  field.onBlur();
                                  validateFields([
                                    "contentId",
                                    "contentSource",
                                  ]);
                                }}
                                onChange={(event) => {
                                  field.onChange(event);
                                  validateFields(
                                    ["contentId", "contentSource"],
                                    {
                                      contentId: event.target.value,
                                    }
                                  );
                                }}
                                placeholder="e.g. 89180"
                              />
                              <FieldError errors={[fieldState.error]} />
                            </Field>
                          )}
                        />
                      </div>

                      <div className="space-y-3 rounded-lg border border-border/70 bg-background/30 p-3">
                        <div>
                          <div className="font-medium text-sm">
                            Torrent hints
                          </div>
                          <p className="mt-1 text-muted-foreground text-xs">
                            Inferred from release name; edit before submit if
                            needed.
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Controller
                            control={form.control}
                            name="releaseYear"
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Year
                                </FieldLabel>
                                <Input
                                  {...field}
                                  aria-invalid={fieldState.invalid}
                                  id={field.name}
                                  inputMode="numeric"
                                  onBlur={() => {
                                    field.onBlur();
                                    validateFields(["releaseYear"]);
                                  }}
                                  placeholder="2026"
                                />
                                <FieldError errors={[fieldState.error]} />
                              </Field>
                            )}
                          />
                          <Controller
                            control={form.control}
                            name="episodes"
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Episodes
                                </FieldLabel>
                                <div className="flex min-w-0 gap-2">
                                  <Input
                                    {...field}
                                    aria-invalid={fieldState.invalid}
                                    className="min-w-0"
                                    id={field.name}
                                    placeholder="S05E01"
                                  />
                                  <EpisodeBuilder
                                    onApply={(value) => field.onChange(value)}
                                    value={field.value ?? ""}
                                  />
                                </div>
                                <FieldError errors={[fieldState.error]} />
                              </Field>
                            )}
                          />
                          <HintSelect
                            control={form.control}
                            label="Resolution"
                            name="videoResolution"
                            values={videoResolutions}
                          />
                          <HintSelect
                            control={form.control}
                            label="Source"
                            name="videoSource"
                            values={videoSources}
                          />
                          <HintSelect
                            control={form.control}
                            label="Codec"
                            name="videoCodec"
                            values={videoCodecs}
                          />
                          <HintSelect
                            control={form.control}
                            label="Modifier"
                            name="videoModifier"
                            values={videoModifiers}
                          />
                          <Controller
                            control={form.control}
                            name="languages"
                            render={({ field, fieldState }) => (
                              <Field data-invalid={fieldState.invalid}>
                                <FieldLabel htmlFor={field.name}>
                                  Languages
                                </FieldLabel>
                                <Input
                                  {...field}
                                  aria-invalid={fieldState.invalid}
                                  id={field.name}
                                  onBlur={() => {
                                    field.onBlur();
                                    validateFields(["languages"]);
                                  }}
                                  placeholder="ru, ja"
                                />
                                <FieldError errors={[fieldState.error]} />
                              </Field>
                            )}
                          />
                        </div>
                        <Controller
                          control={form.control}
                          name="releaseGroup"
                          render={({ field, fieldState }) => (
                            <Field data-invalid={fieldState.invalid}>
                              <FieldLabel htmlFor={field.name}>
                                Release group
                              </FieldLabel>
                              <Input
                                {...field}
                                aria-invalid={fieldState.invalid}
                                id={field.name}
                                placeholder="e.g. AniLiberty"
                              />
                              <FieldError errors={[fieldState.error]} />
                            </Field>
                          )}
                        />
                      </div>
                    </FieldGroup>

                    <Button
                      className="w-full"
                      disabled={submit.isPending}
                      type="submit"
                    >
                      {submit.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Submit
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <CatalogPanel
                fetching={catalog.isFetching}
                loading={catalog.isLoading}
                onEdit={(item) => {
                  form.reset({
                    magnet: item.magnet,
                    action: defaultAction,
                    contentType:
                      item.contentType in contentTypeLabels
                        ? (item.contentType as IntakeInput["contentType"])
                        : "unknown",
                    contentSource: item.contentSource === "tmdb" ? "tmdb" : "",
                    contentId: item.contentId,
                    title: item.discoveredTitle || item.name,
                    releaseYear: item.releaseYear,
                    episodes: item.episodes,
                    videoResolution:
                      item.videoResolution as IntakeInput["videoResolution"],
                    videoSource: item.videoSource as IntakeInput["videoSource"],
                    videoCodec: item.videoCodec as IntakeInput["videoCodec"],
                    videoModifier:
                      item.videoModifier as IntakeInput["videoModifier"],
                    languages: item.languages,
                    releaseGroup: item.releaseGroup,
                  });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onPageChange={setCatalogPage}
                page={catalogPage}
                result={enrichedCatalog}
              />
            </div>
          </TabsContent>

          <TabsContent className="mt-5" value="settings">
            <SettingsPanel
              loading={settings.isLoading}
              readiness={readiness.data}
              settings={settings.data}
            />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
