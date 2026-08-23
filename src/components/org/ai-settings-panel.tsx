"use client";

import { IconCheck, IconSparkles } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AiConfigForm,
  type AiConfigFormInitial,
} from "@/components/ai/ai-config-form";
import { PageHeader } from "@/components/app/page-header";
import {
  Choicebox,
  ChoiceboxIndicator,
  ChoiceboxItem,
  ChoiceboxItemDescription,
  ChoiceboxItemHeader,
  ChoiceboxItemTitle,
} from "@/components/kibo-ui/choicebox";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import {
  clearOrganizationAiKey,
  type OrganizationAiConfigView,
  saveOrganizationAiConfig,
} from "@/lib/actions/ai";
import { AI_PROVIDERS, MODEL_KIND_LABELS } from "@/lib/ai/providers";
import { AI_UNAVAILABLE_COPY } from "@/lib/ai/resolve";

type Mode = "platform" | "own";

export function AiSettingsPanel({
  organizationId,
  organizationName,
  view,
}: {
  organizationId: string;
  organizationName: string;
  view: OrganizationAiConfigView;
}) {
  const router = useRouter();
  const {
    config,
    platform,
    platformAccessAllowed,
    effective,
    secretStorageReady,
  } = view;

  const [mode, setMode] = useState<Mode>(config?.mode ?? "platform");
  const [savingMode, setSavingMode] = useState(false);

  const initial: AiConfigFormInitial | null = config
    ? {
        provider: config.provider,
        baseUrl: config.baseUrl ?? "",
        textModel: config.textModel,
        visionModel: config.visionModel,
        embeddingModel: config.embeddingModel,
        enabled: config.enabled,
        apiKeyHint: config.apiKeyHint,
      }
    : null;

  // Inheriting is only offered when the platform admin allows it *and* a
  // platform configuration actually exists and is switched on.
  const platformUsable = platformAccessAllowed && Boolean(platform?.enabled);

  async function switchToPlatformConfig() {
    setSavingMode(true);
    try {
      await saveOrganizationAiConfig({
        organizationId,
        mode: "platform",
        // Carried through untouched so switching back to "own" doesn't lose
        // the provider and models already set up.
        provider: config?.provider ?? "openrouter",
        baseUrl: config?.baseUrl ?? undefined,
        textModel: config?.textModel ?? null,
        visionModel: config?.visionModel ?? null,
        embeddingModel: config?.embeddingModel ?? null,
        enabled: config?.enabled ?? false,
      });
      toast.success("Now using the platform AI configuration.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save AI settings.",
      );
    } finally {
      setSavingMode(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Organization"
        title="AI"
        description={`Choose the AI provider and models ${organizationName} uses. Keys are encrypted before they're stored.`}
      />

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconSparkles className="size-4 text-muted-foreground" />
              <CardTitle>Current status</CardTitle>
            </div>
            {effective.ok ? (
              <Badge variant="success">
                {effective.source === "platform"
                  ? "Platform config"
                  : "Own provider"}
              </Badge>
            ) : (
              <Badge
                variant={
                  effective.reason === "platform_access_revoked" ||
                  effective.reason === "platform_disabled" ||
                  effective.reason === "key_undecryptable"
                    ? "warning"
                    : "neutral"
                }
              >
                Not active
              </Badge>
            )}
          </div>
          <CardDescription>
            {effective.ok
              ? `AI features use ${AI_PROVIDERS[effective.provider].label} via the ${
                  effective.source === "platform"
                    ? "shared platform configuration"
                    : "provider configured below"
                }.`
              : AI_UNAVAILABLE_COPY[effective.reason].description}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {effective.ok ? (
            <dl className="grid gap-3 sm:grid-cols-3">
              {(["text", "vision", "embedding"] as const).map((kind) => (
                <div key={kind} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                    {MODEL_KIND_LABELS[kind].label}
                  </dt>
                  <dd className="truncate font-mono text-xs">
                    {effective.models[kind] ?? "—"}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm font-semibold">
              {AI_UNAVAILABLE_COPY[effective.reason].title}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b [.border-b]:pb-6">
          <CardTitle>Where the configuration comes from</CardTitle>
          <CardDescription>
            Use the configuration your platform administrator maintains, or run
            your own provider and API key.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 pt-6">
          <Choicebox
            value={mode}
            onValueChange={(value) => setMode(value as Mode)}
            className="grid gap-2 sm:grid-cols-2"
          >
            <ChoiceboxItem
              value="platform"
              id="ai-mode-platform"
              className="items-start"
            >
              <ChoiceboxItemHeader>
                <ChoiceboxItemTitle>
                  Use the platform configuration
                </ChoiceboxItemTitle>
                <ChoiceboxItemDescription>
                  {platformUsable
                    ? `Managed for you — currently ${
                        platform
                          ? AI_PROVIDERS[platform.provider].label
                          : "unset"
                      }.`
                    : platformAccessAllowed
                      ? "Your platform administrator hasn't switched on a shared configuration yet."
                      : "Your platform administrator hasn't granted this organization access."}
                </ChoiceboxItemDescription>
              </ChoiceboxItemHeader>
              <ChoiceboxIndicator />
            </ChoiceboxItem>
            <ChoiceboxItem value="own" id="ai-mode-own" className="items-start">
              <ChoiceboxItemHeader>
                <ChoiceboxItemTitle>Use our own provider</ChoiceboxItemTitle>
                <ChoiceboxItemDescription>
                  Bring your own key and pin your own models. Always available.
                </ChoiceboxItemDescription>
              </ChoiceboxItemHeader>
              <ChoiceboxIndicator />
            </ChoiceboxItem>
          </Choicebox>

          {mode === "platform" ? (
            <div className="flex flex-col gap-4">
              {platformUsable && platform ? (
                <dl className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["text", platform.textModel],
                      ["vision", platform.visionModel],
                      ["embedding", platform.embeddingModel],
                    ] as const
                  ).map(([kind, model]) => (
                    <div key={kind} className="flex min-w-0 flex-col gap-0.5">
                      <dt className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                        {MODEL_KIND_LABELS[kind].label}
                      </dt>
                      <dd className="truncate font-mono text-xs">
                        {model ?? "—"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <Callout tone="warning">
                  {platformAccessAllowed
                    ? AI_UNAVAILABLE_COPY.platform_disabled.description
                    : AI_UNAVAILABLE_COPY.platform_access_revoked.description}
                </Callout>
              )}
              {config?.mode === "platform" ? null : (
                <div className="flex justify-end">
                  <Button
                    onClick={switchToPlatformConfig}
                    disabled={savingMode}
                  >
                    {savingMode ? (
                      <Spinner className="size-4" />
                    ) : (
                      <IconCheck className="size-4" />
                    )}
                    Use platform configuration
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <AiConfigForm
              scope="organization"
              organizationId={organizationId}
              initial={initial}
              secretStorageReady={secretStorageReady}
              onSave={(values) =>
                saveOrganizationAiConfig({
                  organizationId,
                  mode: "own",
                  provider: values.provider,
                  baseUrl: values.baseUrl,
                  apiKey: values.apiKey,
                  textModel: values.textModel,
                  visionModel: values.visionModel,
                  embeddingModel: values.embeddingModel,
                  enabled: values.enabled,
                })
              }
              onClearKey={() => clearOrganizationAiKey({ organizationId })}
            />
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
