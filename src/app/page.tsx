import {
  IconArrowRight,
  IconBolt,
  IconChartBar,
  IconCheck,
  IconCircleCheck,
  IconClockHour4,
  IconSparkles,
  IconTargetArrow,
  IconUsersGroup,
} from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";

const benefits = [
  "Plan with clarity",
  "Ship with confidence",
  "Learn from every sprint",
];

const features = [
  {
    icon: IconTargetArrow,
    title: "A plan everyone can see",
    description:
      "Turn outcomes into focused work, then give every team a shared view of what matters next.",
  },
  {
    icon: IconBolt,
    title: "Momentum without the meetings",
    description:
      "Keep priorities, owners, and progress current in one calm, connected workspace.",
  },
  {
    icon: IconChartBar,
    title: "Signals, not status theatre",
    description:
      "See delivery health at a glance and give your team room to solve the real problems.",
  },
];

export default async function Home() {
  const session = await getSession();
  if (session) redirect("/app");

  return (
    <main className="min-h-screen overflow-hidden bg-canvas text-foreground">
      <header className="mx-auto flex h-18 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="shrink-0" aria-label="Sprintify home">
          <Image
            src="/logos/sprintify-aurora.svg"
            alt="Sprintify"
            width={141}
            height={35}
            className="h-7 w-auto dark:hidden"
            priority
          />
          <Image
            src="/logos/sprintify-aurora-white.svg"
            alt="Sprintify"
            width={141}
            height={35}
            className="hidden h-7 w-auto dark:block"
            priority
          />
        </Link>
        <nav
          className="hidden items-center gap-7 text-sm font-semibold text-muted-foreground md:flex"
          aria-label="Main navigation"
        >
          <a
            className="transition-colors hover:text-foreground"
            href="#product"
          >
            Product
          </a>
          <a
            className="transition-colors hover:text-foreground"
            href="#why-sprintify"
          >
            Why Sprintify
          </a>
          <a className="transition-colors hover:text-foreground" href="#ai">
            AI
          </a>
          <a
            className="transition-colors hover:text-foreground"
            href="#get-started"
          >
            Get started
          </a>
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/sign-in">Log in</Link>}
            className="hidden sm:inline-flex"
          />
          <Button
            variant="gradient"
            nativeButton={false}
            render={
              <Link href="/sign-up">
                Start free <IconArrowRight data-icon="inline-end" />
              </Link>
            }
          />
        </div>
      </header>

      <section className="relative mx-auto grid max-w-6xl gap-12 px-4 pt-16 pb-20 sm:px-6 md:pt-24 lg:grid-cols-[.9fr_1.1fr] lg:items-center lg:gap-8 lg:pb-28">
        <div className="absolute top-0 left-1/2 -z-0 h-96 w-[38rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15" />
        <div className="relative z-10">
          <Badge
            variant="secondary"
            className="mb-5 gap-1.5 px-2.5 py-1 text-secondary-foreground"
          >
            <IconSparkles className="size-3.5" /> Built for teams in motion
          </Badge>
          <h1 className="max-w-xl font-heading text-4xl leading-[1.03] font-extrabold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
            Make every sprint feel <span className="text-brand">possible.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">
            Sprintify brings your plans, progress, and people into one
            beautifully simple place—so great work moves forward.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button
              size="lg"
              variant="gradient"
              nativeButton={false}
              render={
                <Link href="/sign-up">
                  Start building for free{" "}
                  <IconArrowRight data-icon="inline-end" />
                </Link>
              }
            />
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<Link href="/sign-in">Explore your workspace</Link>}
            />
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-1.5">
                <IconCheck className="size-4 text-success" />
                {benefit}
              </li>
            ))}
          </ul>
        </div>

        <div
          className="relative z-10 mx-auto w-full max-w-xl rounded-2xl border border-border bg-card p-3 shadow-[var(--shadow-float)] sm:p-4"
          role="img"
          aria-label="Sprintify project dashboard preview: Product launch sprint is 68 percent complete and on track."
        >
          <div className="flex items-center justify-between border-b border-border px-1 pb-3">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-full bg-primary" />
              <span className="text-sm font-bold">Product launch</span>
            </div>
            <span className="rounded-md bg-secondary px-2 py-1 text-[11px] font-bold tracking-wide text-secondary-foreground">
              SPRINT 12
            </span>
          </div>
          <div className="grid gap-3 py-4 sm:grid-cols-[1.35fr_.85fr]">
            <div className="rounded-xl border border-border bg-muted/55 p-4">
              <p className="text-[11px] font-bold tracking-[.09em] text-muted-foreground uppercase">
                Sprint progress
              </p>
              <div className="mt-4 flex items-end justify-between">
                <strong className="font-heading text-3xl font-extrabold tabular-nums">
                  68%
                </strong>
                <span className="mb-1 text-xs font-semibold text-success">
                  ↗ On track
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-border">
                <div className="h-full w-[68%] rounded-full bg-gradient-brand" />
              </div>
              <div
                className="mt-5 flex h-22 items-end gap-2"
                aria-hidden="true"
              >
                {[33, 47, 42, 61, 54, 76, 68].map((height, index) => (
                  <span
                    key={height}
                    className="flex-1 rounded-t-sm bg-primary/15"
                    style={{
                      height: `${height}%`,
                      opacity: index === 6 ? 1 : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-3.5">
                <div className="flex items-center justify-between">
                  <span className="grid size-8 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                    <IconClockHour4 className="size-4" />
                  </span>
                  <span className="text-xs font-semibold text-success">
                    +12%
                  </span>
                </div>
                <p className="mt-3 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
                  Velocity
                </p>
                <p className="font-heading text-2xl font-extrabold tabular-nums">
                  42 pts
                </p>
              </div>
              <div className="rounded-xl border border-border p-3.5">
                <div className="flex -space-x-1.5">
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-chart-2 text-[9px] font-bold text-white">
                    JM
                  </span>
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-chart-3 text-[9px] font-bold text-white">
                    SK
                  </span>
                  <span className="grid size-7 place-items-center rounded-full border-2 border-card bg-chart-4 text-[9px] font-bold text-white">
                    +6
                  </span>
                </div>
                <p className="mt-3 text-[11px] font-bold tracking-[.08em] text-muted-foreground uppercase">
                  Team focus
                </p>
                <p className="text-sm font-semibold">8 teammates</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-secondary/55 px-3.5 py-3 text-sm">
            <span className="grid size-8 place-items-center rounded-lg bg-card text-success shadow-sm">
              <IconCircleCheck className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              Billing flow is ready to ship
            </span>
            <span className="text-xs text-muted-foreground">Today</span>
          </div>
        </div>
      </section>

      <section id="product" className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-18 sm:px-6 sm:py-22">
          <div className="max-w-2xl">
            <p className="text-[11px] font-bold tracking-[.1em] text-brand uppercase">
              The calmer way to deliver
            </p>
            <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-[-.03em] sm:text-4xl">
              One rhythm for the whole team.
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="rounded-2xl border border-border bg-canvas p-5 shadow-[var(--shadow-card)] transition-transform duration-200 hover:-translate-y-1"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-secondary text-secondary-foreground">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-5 text-base font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="ai"
        className="mx-auto max-w-6xl px-4 py-18 sm:px-6 sm:py-24"
      >
        <div className="grid overflow-hidden rounded-2xl bg-gradient-brand text-white shadow-[var(--shadow-float)] lg:grid-cols-[.9fr_1.1fr]">
          <div className="p-7 sm:p-10">
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-white/12 px-2.5 py-1 text-[11px] font-bold tracking-[.1em] text-white/90 uppercase">
              <IconSparkles className="size-3.5" /> Sprintify AI
            </div>
            <h2 className="mt-5 max-w-md font-heading text-3xl font-extrabold tracking-[-.03em] sm:text-4xl">
              Get from a blank page to a better next step.
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-white/80">
              Turn a rough thought into a focused work item, get caught up on a
              discussion, or find the signal in a busy sprint—without leaving
              your workspace.
            </p>
            <ul className="mt-7 space-y-3 text-sm text-white/90">
              {[
                "Draft clearer work items and updates",
                "Summarize long comment threads",
                "Ask for the next most useful action",
              ].map((benefit) => (
                <li key={benefit} className="flex items-center gap-2">
                  <IconCheck className="size-4 shrink-0" />
                  {benefit}
                </li>
              ))}
            </ul>
            <Button
              className="mt-8 bg-white text-primary hover:bg-white/90"
              nativeButton={false}
              render={
                <Link href="/sign-up">
                  Meet Sprintify AI <IconArrowRight data-icon="inline-end" />
                </Link>
              }
            />
          </div>
          <div className="bg-black/10 p-5 sm:p-8">
            <div className="mx-auto max-w-md rounded-2xl border border-white/15 bg-card p-4 text-foreground shadow-[0_22px_50px_-20px_rgb(0_0_0_/_0.55)] sm:p-5">
              <div className="flex items-center gap-2 border-b border-border pb-4">
                <span className="grid size-8 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <IconSparkles className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Sprintify AI</p>
                  <p className="text-xs text-muted-foreground">
                    Project copilot
                  </p>
                </div>
                <span className="ml-auto size-2 rounded-full bg-success" />
              </div>
              <div className="space-y-4 py-5 text-sm">
                <div className="ml-auto max-w-[86%] rounded-xl rounded-br-sm bg-secondary px-3.5 py-3 text-secondary-foreground">
                  Turn this feedback into a focused next step for the team.
                </div>
                <div className="max-w-[92%] rounded-xl rounded-bl-sm bg-muted px-3.5 py-3 leading-6 text-muted-foreground">
                  I found one clear action: validate the billing copy with three
                  customers before Tuesday&apos;s release review.
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-canvas px-3 py-2.5 text-sm text-muted-foreground">
                <IconSparkles className="size-4 text-brand" />
                Ask anything about this sprint…
                <span className="ml-auto grid size-6 place-items-center rounded-md bg-primary text-white">
                  <IconArrowRight className="size-3.5" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="why-sprintify"
        className="mx-auto grid max-w-6xl gap-10 px-4 py-18 sm:px-6 sm:py-24 lg:grid-cols-2 lg:items-center"
      >
        <div className="rounded-2xl border border-border bg-muted p-6 shadow-[var(--shadow-card)] sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-card text-brand shadow-sm">
              <IconUsersGroup className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                A team that knows the next move
              </p>
              <p className="text-xs text-muted-foreground">
                Shared clarity, every day
              </p>
            </div>
          </div>
          <div className="mt-8 space-y-4">
            {[
              "Design handoff",
              "Customer feedback loop",
              "Release readiness",
            ].map((item, index) => (
              <div
                key={item}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
              >
                <span className="grid size-6 place-items-center rounded-md bg-secondary text-xs font-extrabold text-secondary-foreground">
                  {index + 1}
                </span>
                <span className="flex-1 text-sm font-semibold">{item}</span>
                <IconCheck className="size-4 text-success" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-bold tracking-[.1em] text-brand uppercase">
            Less ceremony. More progress.
          </p>
          <h2 className="mt-3 font-heading text-3xl font-extrabold tracking-[-.03em] sm:text-4xl">
            The work is complex. Your system doesn&apos;t have to be.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-muted-foreground">
            Sprintify creates a reliable home for the decisions that keep work
            moving—without making your team live in spreadsheets, status
            meetings, and scattered tabs.
          </p>
          <Button
            className="mt-7"
            variant="outline"
            nativeButton={false}
            render={
              <Link href="/sign-up">
                Build your first sprint{" "}
                <IconArrowRight data-icon="inline-end" />
              </Link>
            }
          />
        </div>
      </section>

      <section id="get-started" className="px-4 pb-18 sm:px-6 sm:pb-24">
        <div className="mx-auto max-w-6xl rounded-2xl bg-gradient-brand px-6 py-12 text-center text-white shadow-[var(--shadow-float)] sm:px-12 sm:py-16">
          <p className="text-[11px] font-bold tracking-[.12em] text-white/70 uppercase">
            Ready when you are
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl font-heading text-3xl font-extrabold tracking-[-.03em] sm:text-4xl">
            A better sprint starts with a clearer plan.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-white/80">
            Bring your team together, focus on what matters, and make meaningful
            progress this week.
          </p>
          <Button
            className="mt-7 bg-white text-primary hover:bg-white/90"
            size="lg"
            nativeButton={false}
            render={
              <Link href="/sign-up">
                Start for free <IconArrowRight data-icon="inline-end" />
              </Link>
            }
          />
        </div>
      </section>

      <footer className="border-t border-border px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {new Date().getFullYear()} Sprintify. Built for momentum.
          </span>
          <div className="flex gap-4">
            <Link href="/sign-in" className="hover:text-foreground">
              Log in
            </Link>
            <Link href="/sign-up" className="hover:text-foreground">
              Get started
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
