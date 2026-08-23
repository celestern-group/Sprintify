import { IconWifiOff } from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "You're offline",
  description: "This page isn't available without a connection.",
};

export default function OfflinePage() {
  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex size-11 items-center justify-center rounded-md bg-chip text-muted-foreground">
          <IconWifiOff className="size-6" aria-hidden />
        </div>
        <p className="mt-6 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
          No connection
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-foreground">
          You're offline
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn't reach the network. Check your connection — anything you've
          already opened is still available.
        </p>
        <Button
          className="mt-6"
          nativeButton={false}
          render={<Link href="/">Try again</Link>}
        />
      </div>
    </main>
  );
}
