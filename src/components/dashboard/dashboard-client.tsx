"use client";

import {
  IconBriefcase,
  IconMailFast,
  IconPlus,
  IconSparkles,
  IconUsers,
} from "@tabler/icons-react";
import { motion } from "motion/react";
import type * as React from "react";
import type { ActivityPoint } from "@/components/dashboard/mock-data";
import { ActivityChart } from "@/components/dashboard/ui/charts";
import { FeatureCard, GoalRow } from "@/components/dashboard/ui/feature-card";
import { SectionCard } from "@/components/dashboard/ui/section-card";
import { StatCard } from "@/components/dashboard/ui/stat-card";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type RosterMember = { name: string; email: string; role: string };

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0.7, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function DashboardClient({
  orgName,
  userName,
  members,
  pending,
  projects,
  membersDelta,
  membersFoot,
  projectsFoot,
  usage,
  activity,
  roster,
}: {
  orgName: string;
  userName: string;
  members: number;
  pending: number;
  projects: number;
  membersDelta?: string;
  membersFoot: string;
  projectsFoot: string;
  usage: { label: string; detail: string; pct: number }[];
  activity: ActivityPoint[];
  roster: RosterMember[];
}) {
  return (
    <PageContainer width="full">
      {/* page header */}
      <Reveal className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
            Overview
          </div>
          <h1 className="mt-1.5 font-heading text-2xl font-extrabold tracking-tight sm:text-3xl">
            Welcome back, {userName}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Here's how {orgName} is doing today.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="lg">
            <IconPlus data-icon="inline-start" />
            Invite
          </Button>
          <Button variant="gradient" size="lg">
            <IconSparkles data-icon="inline-start" />
            New project
          </Button>
        </div>
      </Reveal>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Reveal delay={0.05}>
          <StatCard
            label="Active members"
            value={members}
            icon={IconUsers}
            tone="brand"
            delta={membersDelta}
            foot={membersDelta ? "new this month" : membersFoot}
          />
        </Reveal>
        <Reveal delay={0.15}>
          <StatCard
            label="Projects"
            value={projects}
            icon={IconBriefcase}
            tone="blue"
            foot={projectsFoot}
          />
        </Reveal>
        <Reveal delay={0.2}>
          <StatCard
            label="Pending invites"
            value={pending}
            icon={IconMailFast}
            tone="amber"
            foot="awaiting response"
          />
        </Reveal>
      </div>

      {/* chart + quotas/feature rail */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Reveal delay={0.25}>
          <SectionCard
            title="Member growth"
            description="Last 8 weeks"
            className="h-full"
          >
            <ActivityChart data={activity} />
          </SectionCard>
        </Reveal>
        <Reveal delay={0.3} className="flex flex-col gap-4">
          <SectionCard
            title="Workspace activity"
            description="Current workspace totals"
          >
            <div>
              {usage.map((q) => (
                <GoalRow key={q.label} {...q} />
              ))}
            </div>
          </SectionCard>
          <FeatureCard
            eyebrow="Sprintify AI"
            title="Your workspace, summarized"
            description="Get a prioritized action list across projects, invites and quotas."
            action={
              // Deep violet is pinned: dark-theme --primary (#8b6cff) fails AA on white.
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md bg-white px-3.5 py-2 text-sm font-bold text-[#4a1fb0] transition-transform hover:-translate-y-px"
              >
                <IconSparkles className="size-4" />
                Get AI insight
              </button>
            }
          />
        </Reveal>
      </div>

      {/* roster — full width, so the columns get room */}
      <div className="grid grid-cols-1 gap-4">
        <Reveal delay={0.35}>
          <SectionCard
            title="Member roster"
            description="Members in this workspace"
            action={
              <Button variant="link" size="sm">
                View all
              </Button>
            }
          >
            {roster.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No members yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
                      <th className="pb-2.5">Member</th>
                      <th className="pb-2.5">Role</th>
                      <th className="pb-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((m) => (
                      <tr
                        key={m.email || m.name}
                        className="border-t border-border"
                      >
                        <td className="py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
                              {initials(m.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-semibold">
                                {m.name}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {m.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 text-muted-foreground capitalize">
                          {m.role}
                        </td>
                        <td className="py-2.5">
                          <Badge variant="success">Active</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </Reveal>
      </div>
    </PageContainer>
  );
}
