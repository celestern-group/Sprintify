"use client";

import { IconCheck, IconPlugConnected, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ModelCombobox } from "@/components/ai/model-combobox";
import {
  Choicebox,
  ChoiceboxIndicator,
  ChoiceboxItem,
  ChoiceboxItemDescription,
  ChoiceboxItemHeader,
  ChoiceboxItemTitle,
} from "@/components/kibo-ui/choicebox";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { testAiConnection } from "@/lib/actions/ai";
import {
  AI_PROVIDER_ORDER,
  AI_PROVIDERS,
  type AiModelKind,
  type AiProvider,
  MODEL_KIND_LABELS,
  resolveBaseUrl,
} from "@/lib/ai/providers";

export type AiConfigFormValues = {
  provider: AiProvider;
  baseUrl: string;
  textModel: string | null;
  visionModel: string | null;
  embeddingModel: string | null;
  enabled: boolean;
};

export type AiConfigFormInitial = AiConfigFormValues & {
  apiKeyHint: string | null;
};

const EMPTY: AiConfigFormInitial = {
  provider: "openrouter",
  baseUrl: "",
  textModel: null,
  visionModel: null,
  embeddingModel: null,
  enabled: false,
  apiKeyHint: null,
};

const MODEL_FIELDS: {
  kind: AiModelKind;
  key: "textModel" | "visionModel" | "embeddingModel";
}[] = [
  { kind: "text", key: "textModel" },
  { kind: "vision", key: "visionModel" },
  { kind: "embedding", key: "embeddingModel" },
];

/**
 * The provider + key + model-slot form, shared by the platform and org
 * surfaces. It never receives or returns a plaintext key: an existing key shows
 * as a hint, and leaving the field blank keeps whatever is stored.
 */
export function AiConfigForm({
  scope,
  organizationId,
  initial,
  secretStorageReady,
  onSave,
  onClearKey,
  extraFields,
}: {
  scope: "platform" | "organization";
  organizationId?: string;
  initial: AiConfigFormInitial | null;
  secretStorageReady: boolean;
  onSave: (values: AiConfigFormValues & { apiKey?: string }) => Promise<void>;
  onClearKey: () => Promise<void>;
  /** Scope-specific controls rendered above the save row (e.g. default access). */
  extraFields?: React.ReactNode;
}) {
  const router = useRouter();
  const start = initial ?? EMPTY;

  const [provider, setProvider] = useState<AiProvider>(start.provider);
  const [baseUrl, setBaseUrl] = useState(start.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [textModel, setTextModel] = useState(start.textModel);
  const [visionModel, setVisionModel] = useState(start.visionModel);
  const [embeddingModel, setEmbeddingModel] = useState(start.embeddingModel);
  const [enabled, setEnabled] = useState(start.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const definition = AI_PROVIDERS[provider];
  const hasStoredKey = Boolean(start.apiKeyHint);
  const effectiveBaseUrl = resolveBaseUrl(provider, baseUrl);

  const models = { textModel, visionModel, embeddingModel };
  const setModel = (key: keyof typeof models, value: string | null) => {
    if (key === "textModel") setTextModel(value);
    if (key === "visionModel") setVisionModel(value);
    if (key === "embeddingModel") setEmbeddingModel(value);
  };

  function switchProvider(next: AiProvider) {
    setProvider(next);
    // Model ids are provider-specific — carrying them across would save an id
    // the new provider has never heard of.
    setTextModel(null);
    setVisionModel(null);
    setEmbeddingModel(null);
    setApiKey("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        provider,
        baseUrl,
        textModel,
        visionModel,
        embeddingModel,
        enabled,
        apiKey: apiKey.trim() || undefined,
      });
      setApiKey("");
      toast.success("AI configuration saved.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save AI settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    setSaving(true);
    try {
      await onClearKey();
      setApiKey("");
      setEnabled(false);
      toast.success("API key removed.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to remove the key.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    try {
      const result = await testAiConnection({
        scope,
        organizationId,
        provider,
        baseUrl,
        apiKey: apiKey.trim() || undefined,
        textModel,
        embeddingModel,
      });
      if (result.ok) {
        toast.success(
          result.checked.length
            ? `Connection works — verified ${result.checked.join(" and ")} in ${result.latencyMs}ms.`
            : `Connection works (${result.latencyMs}ms).`,
        );
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The connection test failed.",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      {!secretStorageReady ? (
        <Callout tone="warning">
          <span className="font-semibold">
            Secret storage isn&apos;t configured.
          </span>{" "}
          Set <code className="font-mono text-xs">AI_ENCRYPTION_KEY</code> in
          the server environment (generate one with{" "}
          <code className="font-mono text-xs">openssl rand -base64 32</code>)
          before saving an API key.
        </Callout>
      ) : null}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="ai-provider">Provider</FieldLabel>
          <FieldDescription>
            Every provider is used through the OpenAI API, so switching one only
            changes the endpoint and the model ids.
          </FieldDescription>
          <Choicebox
            id="ai-provider"
            value={provider}
            onValueChange={(value) => switchProvider(value as AiProvider)}
            className="grid gap-2 sm:grid-cols-3"
          >
            {AI_PROVIDER_ORDER.map((key) => (
              <ChoiceboxItem
                key={key}
                value={key}
                id={`ai-provider-${key}`}
                className="items-start"
              >
                <ChoiceboxItemHeader>
                  <ChoiceboxItemTitle>
                    {AI_PROVIDERS[key].label}
                  </ChoiceboxItemTitle>
                  <ChoiceboxItemDescription>
                    {AI_PROVIDERS[key].description}
                  </ChoiceboxItemDescription>
                </ChoiceboxItemHeader>
                <ChoiceboxIndicator />
              </ChoiceboxItem>
            ))}
          </Choicebox>
        </Field>

        {definition.requiresBaseUrl ? (
          <Field>
            <FieldLabel htmlFor="ai-base-url">Base URL</FieldLabel>
            <Input
              id="ai-base-url"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://your-gateway.example.com/v1"
              autoComplete="off"
              spellCheck={false}
              required
            />
            <FieldDescription>
              Must be a public https:// address — the server calls it directly.
            </FieldDescription>
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="ai-api-key">API key</FieldLabel>
          {hasStoredKey ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="neutral" className="font-mono tabular-nums">
                {start.apiKeyHint}
              </Badge>
              <span className="text-sm text-muted-foreground">
                A key is stored and encrypted.
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearKey}
                disabled={saving}
              >
                <IconTrash className="size-4" />
                Remove
              </Button>
            </div>
          ) : null}
          <Input
            id="ai-api-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              hasStoredKey
                ? "Leave blank to keep the stored key"
                : definition.keyPlaceholder
            }
            autoComplete="off"
            spellCheck={false}
          />
          <FieldDescription>
            Encrypted at rest and never shown again after saving.
            {definition.docsUrl ? (
              <>
                {" "}
                <a
                  href={definition.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-brand hover:underline"
                >
                  Get a key
                </a>
                .
              </>
            ) : null}
          </FieldDescription>
        </Field>

        <FieldSeparator />

        {MODEL_FIELDS.map(({ kind, key }) => (
          <Field key={kind}>
            <FieldLabel htmlFor={`ai-model-${kind}`}>
              {MODEL_KIND_LABELS[kind].label}
            </FieldLabel>
            <ModelCombobox
              id={`ai-model-${kind}`}
              value={models[key]}
              onChange={(value) => setModel(key, value)}
              scope={scope}
              organizationId={organizationId}
              provider={provider}
              kind={kind}
              baseUrl={effectiveBaseUrl}
            />
            <FieldDescription>
              {MODEL_KIND_LABELS[kind].description} Leave blank if you
              don&apos;t use it.
            </FieldDescription>
          </Field>
        ))}

        <FieldSeparator />

        <Field orientation="horizontal">
          <FieldLabel htmlFor="ai-enabled" className="flex-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">
                Enable this configuration
              </span>
              <span className="text-sm font-normal text-muted-foreground">
                Off means AI features stay unavailable, even with a key saved.
              </span>
            </div>
          </FieldLabel>
          <Switch
            id="ai-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!hasStoredKey && !apiKey.trim()}
          />
        </Field>

        {extraFields}
      </FieldGroup>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={runTest}
          disabled={testing || saving}
        >
          {testing ? (
            <Spinner className="size-4" />
          ) : (
            <IconPlugConnected className="size-4" />
          )}
          Test connection
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Spinner className="size-4" />
          ) : (
            <IconCheck className="size-4" />
          )}
          Save configuration
        </Button>
      </div>
    </form>
  );
}
