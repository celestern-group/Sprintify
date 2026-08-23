"use client";

import {
  type Icon,
  IconLogout,
  IconSelector,
  IconUserCircle,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/kibo-ui/spinner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { trackEvent } from "@/lib/analytics";
import { authClient } from "@/lib/auth-client";

/**
 * Account menu: profile, optional cross-scope links, sign out.
 * `variant="sidebar"` renders the user card as a full-width footer card
 * (the v0.3 "user pinned to the sidebar bottom" pattern); the default is the
 * compact top-bar avatar. `secondaryLinks` is the bridge between the app
 * shell (/app) and the (separate) manage shell (/manage-org + /admin) —
 * "Manage organization" / "Admin" from the app, "Back to app" from manage —
 * rather than mixing both nav trees into one sidebar.
 */
export function UserMenu({
  user,
  variant = "topbar",
  secondaryLinks = [],
}: {
  user: { name: string; email: string; image?: string | null };
  variant?: "topbar" | "sidebar";
  secondaryLinks?: { href: string; label: string; icon: Icon }[];
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    trackEvent("auth.sign_out");
    await authClient.signOut();
    router.push("/sign-in");
  }

  const initial = user.name.slice(0, 1).toUpperCase();

  return (
    <DropdownMenu>
      {variant === "sidebar" ? (
        <DropdownMenuTrigger
          aria-label="Account"
          className="flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-card p-2 text-left shadow-card outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Avatar className="size-8">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
          <IconSelector className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger
          aria-label="Account"
          className="rounded-full outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
        >
          <Avatar className="size-7">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="bg-primary text-xs font-bold text-primary-foreground">
              {initial}
            </AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        className="min-w-56"
        align={variant === "sidebar" ? "start" : "end"}
        side={variant === "sidebar" ? "top" : "bottom"}
        sideOffset={6}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="size-8 rounded-lg">
                <AvatarImage src={user.image ?? undefined} />
                <AvatarFallback className="rounded-lg">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/profile")}>
            <IconUserCircle />
            Profile
          </DropdownMenuItem>
          {secondaryLinks.map((link) => (
            <DropdownMenuItem
              key={link.href}
              onClick={() => router.push(link.href)}
            >
              <link.icon />
              {link.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={signingOut} onClick={handleSignOut}>
          {signingOut ? <Spinner /> : <IconLogout />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
