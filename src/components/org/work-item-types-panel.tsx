"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WorkItemTypeIcon } from "@/components/app/backlog/work-item-visuals";
import { PageHeader } from "@/components/app/page-header";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { Spinner } from "@/components/kibo-ui/spinner";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  WORK_ITEM_TONES,
  type WorkItemHierarchyLevel,
  type WorkItemTone,
} from "@/db/schema/work-items";
import type { ManagedWorkItemType } from "@/lib/actions/work-item-types";
import {
  createWorkItemType,
  deleteWorkItemType,
  updateWorkItemType,
} from "@/lib/actions/work-item-types";
import { WORK_ITEM_ICONS, type WorkItemIconName } from "@/lib/work-items";

type Draft = {
  name: string;
  description: string;
  hierarchyLevel: WorkItemHierarchyLevel;
  strictHierarchy: boolean;
  tone: WorkItemTone;
  icon: WorkItemIconName;
  isDefault: boolean;
  tracksDefect: boolean;
};

const EMPTY: Draft = {
  name: "",
  description: "",
  hierarchyLevel: 2,
  strictHierarchy: true,
  tone: "brand",
  icon: "IconFile",
  isDefault: false,
  tracksDefect: false,
};

/**
 * The organization's work item vocabulary — Epic / Story / Task / Bug and
 * whatever else this organization actually works in. Shared by every project,
 * which is why it lives here rather than in a project's settings.
 */
export function WorkItemTypesPanel({
  organizationId,
  organizationName,
  types,
  backHref,
  children,
}: {
  organizationId: string;
  organizationName: string;
  types: ManagedWorkItemType[];
  /** Set when reached from the platform admin's organization detail page. */
  backHref?: string;
  /** The custom fields card — same page, separate concern. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ManagedWorkItemType | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [pending, startTransition] = useTransition();

  function openCreate() {
    setEditing(null);
    setDraft({
      ...EMPTY,
      hierarchyLevel:
        Math.max(-1, ...types.map((type) => type.hierarchyLevel)) + 1,
    });
    setOpen(true);
  }

  function openEdit(type: ManagedWorkItemType) {
    setEditing(type);
    setDraft({
      name: type.name,
      description: type.description ?? "",
      hierarchyLevel: type.hierarchyLevel as WorkItemHierarchyLevel,
      strictHierarchy: type.strictHierarchy,
      tone: type.tone,
      icon: (WORK_ITEM_ICONS as readonly string[]).includes(type.icon)
        ? (type.icon as WorkItemIconName)
        : "IconFile",
      isDefault: type.isDefault,
      tracksDefect: type.tracksDefect,
    });
    setOpen(true);
  }

  function run(work: () => Promise<void>, success: string) {
    startTransition(async () => {
      try {
        await work();
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Something went wrong.",
        );
      }
    });
  }

  function save() {
    run(
      async () => {
        if (editing) {
          await updateWorkItemType({
            typeId: editing.id,
            organizationId,
            name: draft.name,
            description: draft.description || undefined,
            hierarchyLevel: draft.hierarchyLevel,
            strictHierarchy: draft.strictHierarchy,
            tone: draft.tone,
            icon: draft.icon,
            isDefault: draft.isDefault,
            tracksDefect: draft.tracksDefect,
          });
        } else {
          await createWorkItemType({
            organizationId,
            name: draft.name,
            description: draft.description || undefined,
            hierarchyLevel: draft.hierarchyLevel,
            strictHierarchy: draft.strictHierarchy,
            tone: draft.tone,
            icon: draft.icon,
            isDefault: draft.isDefault,
            tracksDefect: draft.tracksDefect,
          });
        }
        setOpen(false);
      },
      editing ? "Type saved." : "Type created.",
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={organizationName}
        title="Work item types"
        description="The vocabulary every project in this organization plans in."
        backHref={backHref}
        backLabel="Back to organization"
      >
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          New type
        </Button>
      </PageHeader>

      <SectionCard
        title="Types"
        description="Level sets the hierarchy. Use any non-negative number; lower numbers sit higher in the tree. A type with strict nesting off ignores it and can be filed under anything."
        bodyClassName="overflow-x-auto"
      >
        <table className="w-full min-w-[44rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              <th scope="col" className="py-2 pr-3">
                Type
              </th>
              <th scope="col" className="py-2 pr-3">
                Level
              </th>
              <th scope="col" className="py-2 pr-3">
                Key
              </th>
              <th scope="col" className="py-2 pr-3 text-right">
                In use
              </th>
              <th scope="col" className="py-2 text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {types.map((type) => (
              <tr key={type.id}>
                <th scope="row" className="py-2.5 pr-3 text-left">
                  <span className="flex items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-chip">
                      <WorkItemTypeIcon type={type} />
                    </span>
                    <span className="font-semibold">{type.name}</span>
                    {type.isDefault ? (
                      <Badge variant="default">Default</Badge>
                    ) : null}
                    {type.tracksDefect ? (
                      <Badge variant="destructive">Defect</Badge>
                    ) : null}
                    {type.strictHierarchy ? null : (
                      <Badge variant="secondary">Nests anywhere</Badge>
                    )}
                    {type.source !== "local" ? (
                      <Badge variant="secondary">{type.source}</Badge>
                    ) : null}
                  </span>
                  {type.description ? (
                    <span className="mt-0.5 block max-w-lg truncate text-xs font-normal text-muted-foreground">
                      {type.description}
                    </span>
                  ) : null}
                </th>
                <td className="py-2.5 pr-3 text-muted-foreground">
                  {type.hierarchyLevel}
                </td>
                <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                  {type.key}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                  {type.itemCount}
                </td>
                <td className="py-2.5 text-right">
                  <span className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${type.name}`}
                      onClick={() => openEdit(type)}
                    >
                      <IconPencil className="size-4" />
                    </Button>
                    <ConfirmDialog
                      title={`Delete ${type.name}?`}
                      description="Only a type no item uses can be deleted."
                      confirmLabel="Delete"
                      variant="destructive"
                      onConfirm={() =>
                        run(
                          () =>
                            deleteWorkItemType({
                              organizationId,
                              typeId: type.id,
                            }),
                          "Type deleted.",
                        )
                      }
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${type.name}`}
                        >
                          <IconTrash className="size-4" />
                        </Button>
                      }
                    />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {children}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? editing.name : "New type"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "The key stays as it was — external systems map onto it."
                : "The key is derived from the name and can't be changed later."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="type-name">Name</FieldLabel>
              <Input
                id="type-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="type-description">Description</FieldLabel>
              <Textarea
                id="type-description"
                rows={2}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="type-level">Level</FieldLabel>
                <Input
                  id="type-level"
                  type="number"
                  min={0}
                  step={1}
                  className="w-full"
                  value={draft.hierarchyLevel}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      hierarchyLevel: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="type-icon">Icon</FieldLabel>
                <NativeSelect
                  id="type-icon"
                  className="w-full"
                  value={draft.icon}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      icon: event.target.value as WorkItemIconName,
                    })
                  }
                >
                  {WORK_ITEM_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {icon.replace("Icon", "")}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="type-tone">Colour</FieldLabel>
                <NativeSelect
                  id="type-tone"
                  className="w-full"
                  value={draft.tone}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      tone: event.target.value as WorkItemTone,
                    })
                  }
                >
                  {WORK_ITEM_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field orientation="horizontal">
              <Switch
                id="type-strict"
                checked={draft.strictHierarchy}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, strictHierarchy: checked })
                }
              />
              <FieldLabel htmlFor="type-strict">
                <span className="block">Only nest under a higher level</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {draft.strictHierarchy
                    ? "On — an item of this type needs a parent above its own level."
                    : "Off — an item of this type can be dropped under anything."}
                </span>
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="type-default"
                checked={draft.isDefault}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, isDefault: checked })
                }
              />
              <FieldLabel htmlFor="type-default">
                Propose this type first when creating an item
              </FieldLabel>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="type-defect"
                checked={draft.tracksDefect}
                onCheckedChange={(checked) =>
                  setDraft({ ...draft, tracksDefect: checked })
                }
              />
              <FieldLabel htmlFor="type-defect">
                Track defects — items get steps to reproduce, expected and
                actual
              </FieldLabel>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || !draft.name.trim()} onClick={save}>
              {pending ? <Spinner className="size-4" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
