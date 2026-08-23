"use client";

import { IconDotsVertical, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import {
  OrganizationFormDialog,
  type OrganizationFormRow,
} from "@/components/admin/organization-form-dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { deleteOrganization } from "@/lib/actions/admin-organizations";

type DialogKind = "edit" | "delete" | null;

export function OrganizationRowMenu({
  organization,
  onChanged,
  onDeleted,
}: {
  organization: OrganizationFormRow;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const [dialog, setDialog] = useState<DialogKind>(null);

  async function remove() {
    try {
      await deleteOrganization(organization.id);
      toast.warning(`${organization.name} deleted.`);
      setDialog(null);
      (onDeleted ?? onChanged)();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to delete organization.",
      );
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm">
              <IconDotsVertical />
              <span className="sr-only">Actions</span>
            </Button>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setDialog("edit")}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDialog("delete")}
          >
            <IconTrash />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <OrganizationFormDialog
        mode="edit"
        organization={organization}
        open={dialog === "edit"}
        onOpenChange={(open) => setDialog(open ? "edit" : null)}
        onDone={onChanged}
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => setDialog(open ? "delete" : null)}
        title={`Delete ${organization.name}?`}
        description="This permanently deletes the organization, its members, and projects. This cannot be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        variant="destructive"
        onConfirm={remove}
      />
    </>
  );
}
