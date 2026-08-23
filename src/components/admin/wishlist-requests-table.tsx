"use client";

import { IconCheck, IconInbox, IconX } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import type { WishlistRequest } from "@/lib/actions/wishlist";
import {
  approveWishlistRequest,
  rejectWishlistRequests,
} from "@/lib/actions/wishlist";

export function WishlistRequestsTable({
  requests,
}: {
  requests: WishlistRequest[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingBulkAction, setPendingBulkAction] = useState<
    "approve" | "reject" | null
  >(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allSelected =
    requests.length > 0 &&
    requests.every((request) => selectedIds.has(request.id));

  function toggleSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(
      checked ? new Set(requests.map((request) => request.id)) : new Set(),
    );
  }

  async function approve(id: string) {
    setPendingId(id);
    try {
      const result = await approveWishlistRequest({ id });
      toast.success(
        result.accountCreated
          ? "Account approved and activation email sent."
          : "Request approved. The person already has an account.",
      );
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to approve request.",
      );
    } finally {
      setPendingId(null);
    }
  }

  async function approveSelected() {
    const ids = [...selectedIds];
    setPendingBulkAction("approve");
    const results = await Promise.allSettled(
      ids.map((id) => approveWishlistRequest({ id })),
    );
    const approved = results.filter(
      (result) => result.status === "fulfilled",
    ).length;
    const failed = results.length - approved;
    if (approved)
      toast.success(
        `${approved} request${approved === 1 ? "" : "s"} approved.`,
      );
    if (failed)
      toast.error(
        `${failed} request${failed === 1 ? "" : "s"} could not be approved.`,
      );
    setSelectedIds(new Set());
    setPendingBulkAction(null);
    router.refresh();
  }

  async function reject(ids: string[]) {
    setPendingBulkAction("reject");
    try {
      const result = await rejectWishlistRequests({ ids });
      toast.success(
        `${result.rejected} request${result.rejected === 1 ? "" : "s"} rejected.`,
      );
      setSelectedIds(new Set());
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to reject request.",
      );
    } finally {
      setPendingBulkAction(null);
    }
  }

  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
            <IconInbox className="size-5" />
          </span>
          <p className="font-semibold">No access requests yet</p>
          <p className="text-sm text-muted-foreground">
            Requests submitted while invite-only mode is on will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {selectedIds.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 pb-5">
          <p className="text-sm font-semibold tabular-nums">
            {selectedIds.size} selected
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={approveSelected}
              disabled={pendingBulkAction !== null || pendingId !== null}
            >
              <IconCheck />
              {pendingBulkAction === "approve"
                ? "Approving…"
                : "Approve selected"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => reject([...selectedIds])}
              disabled={pendingBulkAction !== null || pendingId !== null}
            >
              <IconX />
              {pendingBulkAction === "reject"
                ? "Rejecting…"
                : "Reject selected"}
            </Button>
          </div>
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="Select all requests"
                checked={allSelected}
                onCheckedChange={(checked) => toggleAll(checked === true)}
                disabled={pendingId !== null || pendingBulkAction !== null}
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${request.name}`}
                  checked={selectedIds.has(request.id)}
                  onCheckedChange={(checked) =>
                    toggleSelection(request.id, checked === true)
                  }
                  disabled={pendingId !== null || pendingBulkAction !== null}
                />
              </TableCell>
              <TableCell className="font-semibold">{request.name}</TableCell>
              <TableCell>{request.email}</TableCell>
              <TableCell className="text-muted-foreground">
                {formatDistanceToNow(new Date(request.requestedAt), {
                  addSuffix: true,
                })}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  onClick={() => approve(request.id)}
                  disabled={pendingId !== null}
                >
                  {pendingId === request.id ? (
                    "Approving…"
                  ) : (
                    <>
                      <IconCheck />
                      Approve
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="ml-2"
                  onClick={() => reject([request.id])}
                  disabled={pendingId !== null || pendingBulkAction !== null}
                >
                  <IconX />
                  Reject
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
