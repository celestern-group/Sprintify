"use client";

import {
  IconBuildingCommunity,
  IconMail,
  IconUsers,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  Glimpse,
  GlimpseContent,
  GlimpseTrigger,
} from "@/components/kibo-ui/glimpse";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getMemberGlimpse,
  type MemberGlimpse,
} from "@/lib/actions/member-glimpse";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/work-items";

/**
 * Everything already known about the person from the surface that renders them.
 * The card paints from this on the first frame, so a hover never opens empty.
 */
export type UserGlimpseSeed = {
  /** Null for a name we can no longer resolve (deleted user, audit-only row). */
  memberId?: string | null;
  name: string;
  email?: string | null;
  image?: string | null;
};

/**
 * A hover card for a person, wrapped around whatever already shows their name
 * or avatar — a comment byline, a history row, the assignee cell.
 *
 * Two-stage on purpose. The seed the caller already holds (name, and usually an
 * avatar and email) renders immediately; the org role, teams and project role
 * are fetched on FIRST OPEN and then cached per member for the life of the
 * page, because those facts are not in any list payload and adding them to
 * every one would put a teams join behind every board render for data almost
 * nobody hovers.
 *
 * Without a `memberId` there is nothing to fetch — an audit row whose user was
 * deleted still has a name, and it gets the seed card alone rather than a
 * spinner that resolves to nothing.
 */
export function UserGlimpse({
  seed,
  projectId,
  children,
  className,
  interactive = true,
}: {
  seed: UserGlimpseSeed;
  /** Adds "their role on THIS project" to the card when supplied. */
  projectId?: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Whether the trigger is a keyboard tab stop. True (a button) wherever the
   * name is the point — bylines, history, the item's assignee. False (a span,
   * hover only) for the decorative avatars repeated once per row in a board or
   * table, where a stop per row would bury the row's own links; the same person
   * is reachable from the item page those rows link to.
   */
  interactive?: boolean;
}) {
  const [detail, setDetail] = useState<MemberGlimpse | null>(() =>
    seed.memberId ? (CACHE.get(seed.memberId) ?? null) : null,
  );
  const [loading, setLoading] = useState(false);

  const memberId = seed.memberId ?? null;

  function handleOpenChange(open: boolean) {
    if (!open || !memberId || detail || loading) return;
    setLoading(true);
    getMemberGlimpse({ memberId, projectId })
      .then((row) => {
        if (row) CACHE.set(memberId, row);
        setDetail(row);
      })
      // A failed lookup is not worth an error state: the seed card is still
      // a correct, if thinner, answer to "who is this".
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const name = detail?.name ?? seed.name;
  const email = detail?.email ?? seed.email ?? null;
  const image = detail?.image ?? seed.image ?? null;
  const pending = loading && !detail;

  return (
    <Glimpse onOpenChange={handleOpenChange}>
      <GlimpseTrigger
        render={
          interactive ? (
            <button
              className={cn(
                "cursor-default rounded-[8px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
                className,
              )}
              type="button"
            />
          ) : (
            <span className={className} />
          )
        }
      >
        {children}
      </GlimpseTrigger>

      <GlimpseContent className="w-72 p-0">
        <div className="flex items-center gap-3 p-4">
          <Avatar size="lg">
            {image ? <AvatarImage alt="" src={image} /> : null}
            <AvatarFallback>{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-semibold text-sm">{name}</p>
            {email ? (
              <a
                className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
                href={`mailto:${email}`}
              >
                <IconMail className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{email}</span>
              </a>
            ) : null}
          </div>
        </div>

        {pending ? (
          <div className="flex flex-col gap-2 border-border border-t p-4">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        ) : null}

        {detail ? (
          <dl className="flex flex-col gap-2 border-border border-t p-4 text-xs">
            <Row
              icon={<IconBuildingCommunity className="size-3.5" />}
              label="Org role"
            >
              {ORG_ROLE_LABELS[detail.orgRole] ?? detail.orgRole}
              {detail.projectRole ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {detail.projectRole} on this project
                </span>
              ) : null}
            </Row>

            {detail.teams.length > 0 ? (
              <Row icon={<IconUsers className="size-3.5" />} label="Teams">
                {detail.teams.slice(0, 3).join(", ")}
                {detail.teams.length > 3 ? (
                  <span className="text-muted-foreground">
                    {" "}
                    +{detail.teams.length - 3}
                  </span>
                ) : null}
              </Row>
            ) : null}

            <p className="text-muted-foreground">
              Member since {formatJoined(detail.joinedAt)}
            </p>
          </dl>
        ) : null}
      </GlimpseContent>
    </Glimpse>
  );
}

/**
 * Detail keyed by member id, for the life of the page. A person's role and
 * teams don't move while you read one board, and a comment thread renders the
 * same author twenty times — refetching per hover would be the whole cost of
 * this feature.
 */
const CACHE = new Map<string, MemberGlimpse>();

const ORG_ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 font-semibold">{children}</dd>
    </div>
  );
}

/** Month + year only: the day someone joined is noise, the season isn't. */
function formatJoined(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}
