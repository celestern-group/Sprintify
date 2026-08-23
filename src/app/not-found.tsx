import { IconCompass } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-4">
      <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-card p-10 text-center shadow-card">
        <div className="grid size-11 place-items-center rounded-md bg-chip text-muted-foreground">
          <IconCompass className="size-5" />
        </div>
        <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-brand">
          404
        </div>
        <h1 className="font-heading text-xl font-extrabold tracking-tight">
          Page not found
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you're looking for doesn't exist or may have moved.
        </p>
        <Button
          className="mt-2"
          nativeButton={false}
          render={<Link href="/app">Back to app</Link>}
        />
      </div>
    </div>
  );
}
