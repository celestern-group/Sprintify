"use client";

import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { listAiModels } from "@/lib/actions/ai";
import type { CatalogModel } from "@/lib/ai/catalog";
import type { AiModelKind, AiProvider } from "@/lib/ai/providers";

// OpenRouter lists ~340 models. Rendering them all is a real DOM cost for no
// benefit, so the list is capped and the footer says so — silently truncating
// would read as "that's everything".
const MAX_RENDERED = 50;

function formatContext(tokens: number | null) {
  if (!tokens) return null;
  return tokens >= 1000
    ? `${Math.round(tokens / 1000).toLocaleString()}K ctx`
    : `${tokens} ctx`;
}

function formatPrice(pricePerMillion: number | null) {
  if (pricePerMillion === null) return null;
  if (pricePerMillion === 0) return "Free";
  const rounded =
    pricePerMillion < 1
      ? pricePerMillion.toFixed(2)
      : pricePerMillion.toFixed(pricePerMillion < 10 ? 2 : 0);
  return `$${rounded}/M`;
}

/**
 * Searchable model picker. The catalog is an autocomplete source, not a
 * validator — whatever is typed is kept, so a self-hosted gateway's model id
 * still saves when the catalog can't be listed.
 */
export function ModelCombobox({
  id,
  value,
  onChange,
  scope,
  organizationId,
  provider,
  kind,
  baseUrl,
  disabled,
  placeholder,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  scope: "platform" | "organization";
  organizationId?: string;
  provider: AiProvider;
  kind: AiModelKind;
  baseUrl: string | null;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two distinct things that both look like "the text in the box":
  //  - inputValue is what's displayed, and Base UI also writes to it when it
  //    syncs the input to the selected item.
  //  - query is what the user actually typed to search with.
  // They must not be the same state: after picking an item the input holds that
  // item's full id, and using that as a search query would filter the list down
  // to the single row already chosen.
  const [inputValue, setInputValue] = useState(value ?? "");
  const [query, setQuery] = useState("");
  // Switching provider fires a second request while the first is in flight;
  // only the newest one may write state.
  const requestId = useRef(0);

  // Switching provider clears the pinned model from the parent; drop the
  // visible text and the search with it. Typing and selecting keep themselves
  // in sync below, so this only needs to handle the external reset.
  useEffect(() => {
    if (value === null) {
      setInputValue("");
      setQuery("");
    }
  }, [value]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await listAiModels({
        scope,
        organizationId,
        provider,
        kind,
        baseUrl: baseUrl ?? undefined,
      });
      if (id !== requestId.current) return;
      if (result.ok) {
        setModels(result.models);
      } else {
        setModels([]);
        setError(result.error);
      }
    } catch (cause) {
      if (id !== requestId.current) return;
      setModels([]);
      setError(
        cause instanceof Error ? cause.message : "Could not load models.",
      );
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [scope, organizationId, provider, kind, baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? models.filter((model) =>
            `${model.id} ${model.name}`.toLowerCase().includes(needle),
          )
        : models,
    [models, needle],
  );
  const visible = matches.slice(0, MAX_RENDERED);
  const visibleIds = useMemo(() => visible.map((model) => model.id), [visible]);
  const byId = useMemo(
    () => new Map(visible.map((model) => [model.id, model])),
    [visible],
  );

  return (
    <div className="flex flex-col gap-1.5">
      {/*
        Item values are the model id itself, not the CatalogModel object, so the
        controlled `value` and the item values are the same type. Base UI
        force-fills the input from the *selected value* when an item is pressed;
        with a mismatched or pinned-null `value` that fill immediately clears
        what was just chosen.
      */}
      <Combobox<string>
        items={visibleIds}
        filter={null}
        value={value}
        onValueChange={(next) => {
          onChange(next);
          // The chosen id now fills the input; it is not a search term.
          setQuery("");
        }}
        inputValue={inputValue}
        onInputValueChange={(next, details) => {
          setInputValue(next);

          if (details.reason === "input-change") {
            // Real typing: this is the search term, and it is also the value —
            // the catalog is autocomplete, not an allow-list, so an id that
            // isn't listed (self-hosted gateway, brand-new model) still counts.
            setQuery(next);
            onChange(next.trim() || null);
            return;
          }

          if (
            details.reason === "input-clear" ||
            details.reason === "clear-press"
          ) {
            setQuery("");
            onChange(null);
            return;
          }

          // Anything else (item-press, list-navigation, focus-out) is Base UI
          // writing the selected item's label back into the input. Leave the
          // search cleared so the full list is still browsable.
          setQuery("");
        }}
        itemToStringLabel={(model) => model ?? ""}
        disabled={disabled}
      >
        <ComboboxInput
          id={id}
          placeholder={placeholder ?? "Search or type a model id…"}
          disabled={disabled}
          showClear
        />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>
              {loading
                ? "Loading models…"
                : "No models match — what you typed will be used as-is."}
            </ComboboxEmpty>
            {visibleIds.map((modelId) => {
              const model = byId.get(modelId);
              return (
                <ComboboxItem key={modelId} value={modelId}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-mono text-xs">
                      {modelId}
                    </span>
                    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{model?.name}</span>
                      {formatContext(model?.contextLength ?? null) ? (
                        <span className="shrink-0 tabular-nums">
                          {formatContext(model?.contextLength ?? null)}
                        </span>
                      ) : null}
                      {formatPrice(model?.promptPricePerMillion ?? null) ? (
                        <span className="shrink-0 tabular-nums">
                          {formatPrice(model?.promptPricePerMillion ?? null)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </ComboboxItem>
              );
            })}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {loading ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          Loading models…
        </p>
      ) : error ? (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <IconAlertTriangle className="size-3.5 shrink-0 text-warning" />
          <span className="min-w-0">
            {error} You can still type a model id.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={load}
          >
            <IconRefresh className="size-3" />
            Retry
          </Button>
        </p>
      ) : matches.length > visible.length ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Showing {visible.length} of {matches.length} — keep typing to narrow.
        </p>
      ) : null}
    </div>
  );
}
