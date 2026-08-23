"use client";

import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDots,
  IconFile,
  IconFilter,
  IconPlus,
  IconSparkles,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import {
  Pill,
  PillAvatar,
  PillButton,
  PillDelta,
  PillIcon,
  PillIndicator,
  PillStatus,
} from "@/components/kibo-ui/pill";
import { PageContainer } from "@/components/layout/page-container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const TOKENS = [
  { name: "primary", cssVar: "--primary" },
  { name: "secondary (tint)", cssVar: "--secondary" },
  { name: "accent (hover)", cssVar: "--accent" },
  { name: "muted", cssVar: "--muted" },
  { name: "border", cssVar: "--border" },
  { name: "destructive", cssVar: "--destructive" },
  { name: "success", cssVar: "--success" },
  { name: "warning", cssVar: "--warning" },
  { name: "critical", cssVar: "--critical" },
  { name: "ring", cssVar: "--ring" },
  { name: "chart-1", cssVar: "--chart-1" },
  { name: "chart-2", cssVar: "--chart-2" },
  { name: "chart-3", cssVar: "--chart-3" },
  { name: "chart-4", cssVar: "--chart-4" },
  { name: "chart-5", cssVar: "--chart-5" },
];

const MEMBERS = [
  {
    name: "Mika Patel",
    email: "mika@acme.dev",
    role: "Owner",
    status: "Active",
    teams: 4,
    lastActive: "2026-07-17 09:12",
    selected: false,
  },
  {
    name: "Jordan Reyes",
    email: "jordan@acme.dev",
    role: "Admin",
    status: "In progress",
    teams: 2,
    lastActive: "2026-07-16 18:47",
    selected: true,
  },
  {
    name: "Sam Okafor",
    email: "sam@acme.dev",
    role: "Member",
    status: "Pending",
    teams: 0,
    lastActive: "invited Jul 14",
    selected: false,
  },
  {
    name: "Lena Kovač",
    email: "lena@acme.dev",
    role: "Member",
    status: "Suspended",
    teams: 1,
    lastActive: "2026-06-30 11:02",
    selected: false,
  },
];

const STATUS_VARIANT = {
  Active: "success",
  "In progress": "default",
  Pending: "warning",
  Suspended: "destructive",
} as const;

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t pt-5">
      <h2 className="flex items-baseline gap-2.5 text-[11px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
        <span className="font-mono text-brand normal-case">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function StyleguideClient() {
  return (
    <PageContainer>
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-[0.09em] text-brand uppercase">
            Sprintify DS v0.3 — Aurora
          </p>
          <h1 className="font-heading text-3xl font-extrabold tracking-tight">
            Styleguide
          </h1>
          <p className="text-sm text-muted-foreground">
            Living reference — check new UI against this page in both themes.
            Dev-only route.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Section n="01" title="Color tokens">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {TOKENS.map((t) => (
            <div
              key={t.cssVar}
              className="flex items-center gap-2.5 rounded-md border p-2"
            >
              <span
                className="size-7 shrink-0 rounded-sm border"
                style={{ background: `var(${t.cssVar})` }}
              />
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold">
                  {t.name}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {t.cssVar}
                </span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section n="02" title="Type ramp — all Nunito Sans">
        <div className="flex flex-col gap-3">
          <p className="font-heading text-3xl font-extrabold tracking-tight">
            Display / page title 30/800 — Everything your org does, in one place
          </p>
          <p className="text-[15px] font-semibold tracking-tight">
            Section title 15/600 — Pending invitations
          </p>
          <p className="text-sm">
            Body 14/400 — Members can view all teams. Only admins can change
            roles or remove people from the organization.
          </p>
          <p className="text-xs text-muted-foreground">
            Meta 12/400 — Invited 3 days ago · expires Jul 24, 2026
          </p>
          <p className="text-[11px] font-bold tracking-[0.09em] text-muted-foreground uppercase">
            Label 11/700 caps +9% — Last active
          </p>
          <p className="text-3xl font-extrabold tracking-tight tabular-nums">
            KPI value 29/800 — 1,284
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            Data 12/400 tabular — org_8fk2 · 2026-07-17 14:32 · 1,284 events
          </p>
        </div>
      </Section>

      <Section n="03" title="Buttons — one violet action per view">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button>
            <IconPlus data-icon="inline-start" />
            Invite member
          </Button>
          <Button variant="outline">Export CSV</Button>
          <Button variant="secondary">Selected state</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="destructive">Remove</Button>
          <Button disabled>Invite member</Button>
          <Button variant="link">Learn more</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button size="lg">Large 36</Button>
          <Button size="default" variant="outline">
            Default 32
          </Button>
          <Button size="sm" variant="outline">
            Small 28
          </Button>
          <Button size="xs" variant="outline">
            XS 24
          </Button>
          <Button size="icon" variant="outline" aria-label="More">
            <IconDots />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          One violet primary per view (gradient in expressive tone, solid in
          restrained); every other button is a subtle neutral fill or ghost —
          never a hairline outline. Destructive is outlined magenta that only
          fills on hover, so danger never shouts before it&apos;s aimed at.
        </p>
      </Section>

      <Section n="04" title="Inputs & selects — hairline, 32px">
        <div className="flex max-w-2xl flex-col gap-4 sm:flex-row">
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="sg-email">Email address</Label>
            <Input id="sg-email" placeholder="name@company.com" />
          </div>
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="sg-role">Role</Label>
            <Select defaultValue="member">
              <SelectTrigger id="sg-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="owner">Owner</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="member">Member</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-full flex-col gap-1.5">
            <Label htmlFor="sg-invalid">Invalid</Label>
            <Input id="sg-invalid" aria-invalid defaultValue="not-an-email" />
          </div>
        </div>
      </Section>

      <Section n="05" title="Status lozenges — neutral chip, colour in the dot">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="neutral">Draft</Badge>
          <Badge>In progress</Badge>
          <Badge variant="success">Active</Badge>
          <Badge variant="warning">Pending</Badge>
          <Badge variant="info">Scheduled</Badge>
          <Badge variant="critical">Overdue</Badge>
          <Badge variant="destructive">Suspended</Badge>
          <Badge variant="outline">Legacy outline alias</Badge>
          <Badge variant="secondary">Secondary</Badge>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          22px tall, 8px dot, ink label — the chip surface never takes the hue.
          Icon tiles follow the same rule: neutral chip square, coloured glyph;
          only the brand tile keeps the violet tint.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <IconSparkles className="size-4.5" aria-hidden />
          </span>
          <span className="grid size-9 place-items-center rounded-md bg-chip text-chart-2">
            <IconUsers className="size-4.5" aria-hidden />
          </span>
          <span className="grid size-9 place-items-center rounded-md bg-chip text-success">
            <IconCircleCheck className="size-4.5" aria-hidden />
          </span>
          <span className="grid size-9 place-items-center rounded-md bg-chip text-warning">
            <IconAlertTriangle className="size-4.5" aria-hidden />
          </span>
          <span className="grid size-9 place-items-center rounded-md bg-chip text-muted-foreground">
            <IconFile className="size-4.5" aria-hidden />
          </span>
        </div>
      </Section>

      <Section
        n="05b"
        title="Pills — Kibo UI Pill, re-tokened (24px, fully round)"
      >
        <p className="text-sm text-muted-foreground">
          The round sibling of the lozenge: counts, dismissible tags, avatar-led
          chips and live state. 24px tall, so an avatar or a dismiss button fits
          without being clipped. Every colour is a DS token — upstream Kibo
          ships raw{" "}
          <code className="font-mono text-xs">emerald/rose/amber/sky</code>,
          which ignore the theme and a white-label accent swap.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <Pill className="tabular-nums">24</Pill>
          <Pill className="tabular-nums">
            <PillIndicator variant="warning" />
            9/6
          </Pill>
          <Pill>
            <PillIndicator pulse variant="success" />
            Live
          </Pill>
          <Pill themed>
            <PillIcon icon={IconSparkles} className="text-inherit" />
            AI drafted
          </Pill>
          <Pill>
            <PillAvatar fallback="MP" />
            Mika Patel
          </Pill>
          <Pill>
            <PillStatus>
              <PillIndicator variant="success" />
              Passing
            </PillStatus>
            build #1284
          </Pill>
          <Pill className="tabular-nums">
            <PillDelta delta={1} />
            12.4%
          </Pill>
          <Pill className="tabular-nums">
            <PillDelta delta={-1} />
            3.1%
          </Pill>
          <Pill>
            Design
            <PillButton aria-label="Remove Design">
              <IconX />
            </PillButton>
          </Pill>
        </div>
        <p className="text-sm text-muted-foreground">
          <code className="font-mono text-xs">PillIndicator</code> and{" "}
          <code className="font-mono text-xs">PillDelta</code> are{" "}
          <code className="font-mono text-xs">aria-hidden</code> / sr-only
          labelled, so status is never carried by hue alone. The pulse layer is
          removed outright under reduced motion, not paused — pausing strands a
          permanent halo that reads as its own state.
        </p>
      </Section>

      <Section n="06" title="Tabs — underline, violet edge">
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="invitations">Invitations</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="pt-3 text-muted-foreground">
            Tab panels inherit body type. The active tab keeps the 2px violet
            bottom edge — the one place a hard edge survives.
          </TabsContent>
          <TabsContent value="teams" className="pt-3 text-muted-foreground">
            Teams panel.
          </TabsContent>
          <TabsContent
            value="invitations"
            className="pt-3 text-muted-foreground"
          >
            Invitations panel.
          </TabsContent>
          <TabsContent value="settings" className="pt-3 text-muted-foreground">
            Settings panel.
          </TabsContent>
        </Tabs>
      </Section>

      <Section n="07" title="Dense table — selected row gets a filled tint">
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Teams</TableHead>
                <TableHead>Last active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MEMBERS.map((m) => (
                <TableRow
                  key={m.email}
                  data-state={m.selected ? "selected" : undefined}
                >
                  <TableCell>
                    <span className="font-medium">{m.name}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </TableCell>
                  <TableCell>{m.role}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        STATUS_VARIANT[m.status as keyof typeof STATUS_VARIANT]
                      }
                    >
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {m.teams > 0 ? m.teams : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {m.lastActive}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Section>

      <Section n="08" title="Floating — dialog, menu, tooltip, toast">
        <div className="flex flex-wrap items-center gap-2.5">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>
              Open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Transfer ownership</DialogTitle>
                <DialogDescription>
                  Jordan Reyes becomes the owner of Acme Robotics. You&apos;ll
                  remain an admin.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter showCloseButton>
                <Button>Transfer</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              <IconFilter data-icon="inline-start" />
              Row menu
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Member</DropdownMenuLabel>
              <DropdownMenuItem>Edit role</DropdownMenuItem>
              <DropdownMenuItem>View activity</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                Remove from org
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>
              Hover me
            </TooltipTrigger>
            <TooltipContent>Tooltips stay solid and small</TooltipContent>
          </Tooltip>

          <Button
            variant="outline"
            onClick={() => toast.success("Invitation sent to sam@acme.dev")}
          >
            Toast
          </Button>

          <Button
            variant="outline"
            onClick={() =>
              toast.error("Unable to save the sprint.", {
                description:
                  "The sprint dates overlap Sprint 14 in this project.",
              })
            }
          >
            Error toast
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Content cards float with a hairline + soft shadow; menus, dialogs, and
          tooltips carry a deeper shadow.
        </p>
      </Section>

      <Section n="09" title="Card">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
              <CardDescription>
                People with access to this organization.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-extrabold tabular-nums">
              24
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>Awaiting acceptance.</CardDescription>
            </CardHeader>
            <CardContent className="text-3xl font-extrabold tabular-nums">
              3
            </CardContent>
          </Card>
        </div>
      </Section>

      <Toaster />
    </PageContainer>
  );
}
