"use client";

import {
  IconChevronDown,
  IconClipboardPlus,
  IconUserPlus,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trackEvent } from "@/lib/analytics";

/** Top-bar violet "Create" action: the one filled-primary action in the chrome. */
export function CreateMenu({
  activeSlug,
  canManageOrg,
  newItemHref,
}: {
  activeSlug?: string;
  canManageOrg: boolean;
  /** New-work-item route for the active project; absent hides the entry. */
  newItemHref?: string;
}) {
  const router = useRouter();
  const showInvite = canManageOrg && activeSlug;

  if (!showInvite && !newItemHref) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="max-sm:px-2">
            Create
            <IconChevronDown className="-mr-0.5 size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-52">
        {newItemHref ? (
          <DropdownMenuItem
            onClick={() => {
              trackEvent("work_item.create", { source: "create_menu" });
              router.push(newItemHref);
            }}
          >
            <IconClipboardPlus />
            Work item
          </DropdownMenuItem>
        ) : null}
        {showInvite ? (
          <DropdownMenuItem
            onClick={() => {
              trackEvent("ui.shortcut_press", {
                action: "invite_member",
                source: "create_menu",
              });
              router.push(`/manage-org/${activeSlug}/members`);
            }}
          >
            <IconUserPlus />
            Invite member
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
