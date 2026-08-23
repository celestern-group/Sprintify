"use client";

import { formatDistanceToNow } from "date-fns";
import { CopyIcon, KeyRoundIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { createMcpApiKey } from "@/lib/actions/api-keys";
import { authClient } from "@/lib/auth-client";

type ApiKey = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: string | Date;
  lastRequest: string | Date | null;
};

function formattedDate(value: string | Date) {
  return formatDistanceToNow(new Date(value), { addSuffix: true });
}

export function ApiKeysCard() {
  const [apiKeys, setApiKeys] = useState<ApiKey[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [writeAccess, setWriteAccess] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);

  const loadKeys = useCallback(async () => {
    setLoadError(null);
    const { data, error } = await authClient.apiKey.list({
      query: { sortBy: "createdAt", sortDirection: "desc" },
    });

    if (error) {
      setLoadError(error.message ?? "Unable to load API keys.");
      return;
    }

    setApiKeys((data?.apiKeys ?? []) as ApiKey[]);
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    let data: { key: string } | null = null;
    let error: { message?: string } | null = null;
    try {
      data = await createMcpApiKey({
        name: name.trim() || undefined,
        writeAccess,
      });
    } catch (cause) {
      error = cause as { message?: string };
    }
    setCreating(false);

    if (error || !data?.key) {
      toast.error(error?.message ?? "Unable to create API key.");
      return;
    }

    setCreatedKey(data.key);
    setName("");
    setWriteAccess(false);
    setCreateOpen(false);
    await loadKeys();
  }

  async function deleteKey(key: ApiKey) {
    const { error } = await authClient.apiKey.delete({ keyId: key.id });
    if (error) {
      toast.error(error.message ?? "Unable to revoke API key.");
      throw error;
    }

    setApiKeys(
      (current) => current?.filter((item) => item.id !== key.id) ?? [],
    );
    toast.success("API key revoked.");
  }

  async function copyKey() {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      toast.success("API key copied.");
    } catch {
      toast.error("Unable to copy the API key.");
    }
  }

  return (
    <Card>
      <CardHeader className="border-b [.border-b]:pb-6">
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Create personal keys for MCP access. Keys are read-only unless you
          explicitly enable write access.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {loadError ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{loadError}</span>
            <Button size="sm" variant="outline" onClick={() => void loadKeys()}>
              Retry
            </Button>
          </div>
        ) : apiKeys === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading API keys…
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-[var(--r-ctrl)] bg-muted p-4">
            <KeyRoundIcon className="size-4 text-brand" aria-hidden="true" />
            <p className="text-sm font-medium">No API keys yet</p>
            <p className="text-sm text-muted-foreground">
              Create a key to connect an MCP client to your account.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--r-ctrl)] border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {key.name || "Unnamed API key"}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {key.start ? `${key.start}… · ` : ""}Created{" "}
                    {formattedDate(key.createdAt)}
                    {key.lastRequest
                      ? ` · Last used ${formattedDate(key.lastRequest)}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => setDeleteTarget(key)}
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-end border-t [.border-t]:pt-6">
        <Button onClick={() => setCreateOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          Create API key
        </Button>
      </CardFooter>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setName("");
          if (!open) setWriteAccess(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Give this key a recognizable name. It starts with read-only MCP
              access.
            </DialogDescription>
          </DialogHeader>
          <form id="create-api-key-form" onSubmit={createKey}>
            <Field>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <Input
                id="api-key-name"
                value={name}
                maxLength={100}
                placeholder="My MCP client"
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                Optional, but helps you identify the key later.
              </FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="api-key-write-access"
                checked={writeAccess}
                onCheckedChange={(checked) => setWriteAccess(checked === true)}
              />
              <div className="grid gap-1">
                <FieldLabel htmlFor="api-key-write-access">
                  Allow backlog changes
                </FieldLabel>
                <FieldDescription>
                  Lets this key create, edit, move, and delete backlog data.
                </FieldDescription>
              </div>
            </Field>
          </form>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={creating} />}
            >
              Cancel
            </DialogClose>
            <Button
              form="create-api-key-form"
              type="submit"
              disabled={creating}
            >
              {creating ? <Spinner /> : null}
              {creating ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => !open && setCreatedKey(null)}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Copy your API key now</DialogTitle>
            <DialogDescription>
              This is the only time the complete key can be shown. Store it in
              your password manager before closing this dialog.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 items-center gap-2 rounded-[var(--r-ctrl)] bg-muted p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">
              {createdKey}
            </code>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => void copyKey()}
            >
              <CopyIcon />
              <span className="sr-only">Copy API key</span>
            </Button>
          </div>
          <DialogFooter>
            <DialogClose render={<Button />}>I&apos;ve saved it</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Revoke this API key?"
        description={`This immediately disconnects ${deleteTarget?.name || "this API key"}. This cannot be undone.`}
        confirmLabel="Revoke key"
        pendingLabel="Revoking…"
        variant="destructive"
        onConfirm={async () => {
          if (deleteTarget) await deleteKey(deleteTarget);
        }}
      />
    </Card>
  );
}
