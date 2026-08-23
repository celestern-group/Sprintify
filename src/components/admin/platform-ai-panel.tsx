"use client";

import { IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
import {
  AiConfigForm,
  type AiConfigFormInitial,
} from "@/components/ai/ai-config-form";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  clearPlatformAiKey,
  type PlatformAiConfigView,
  savePlatformAiConfig,
} from "@/lib/actions/admin-ai";

export function PlatformAiPanel({ view }: { view: PlatformAiConfigView }) {
  const { config, secretStorageReady } = view;
  const [defaultOrgAccess, setDefaultOrgAccess] = useState(
    config?.defaultOrgAccess ?? false,
  );

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

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <IconSparkles className="size-4 text-muted-foreground" />
            <CardTitle>Shared AI provider</CardTitle>
          </div>
          {config?.enabled ? (
            <Badge variant="success">Active</Badge>
          ) : (
            <Badge variant="neutral">Inactive</Badge>
          )}
        </div>
        <CardDescription>
          The platform-wide provider, key, and models. Organizations use this
          only when you grant them access below — otherwise they bring their
          own.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <AiConfigForm
          scope="platform"
          initial={initial}
          secretStorageReady={secretStorageReady}
          onSave={(values) =>
            savePlatformAiConfig({
              provider: values.provider,
              baseUrl: values.baseUrl,
              apiKey: values.apiKey,
              textModel: values.textModel,
              visionModel: values.visionModel,
              embeddingModel: values.embeddingModel,
              enabled: values.enabled,
              defaultOrgAccess,
            })
          }
          onClearKey={clearPlatformAiKey}
          extraFields={
            <Field orientation="horizontal">
              <FieldLabel htmlFor="ai-default-org-access" className="flex-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold">
                    Share with organizations by default
                  </span>
                  <span className="text-sm font-normal text-muted-foreground">
                    Applies to every organization without an explicit allow or
                    deny below. Off keeps the shared key opt-in.
                  </span>
                </div>
              </FieldLabel>
              <Switch
                id="ai-default-org-access"
                checked={defaultOrgAccess}
                onCheckedChange={setDefaultOrgAccess}
              />
            </Field>
          }
        />
      </CardContent>
    </Card>
  );
}
