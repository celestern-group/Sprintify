"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function ProjectTabs({ basePath }: { basePath: string }) {
  const pathname = usePathname();
  const tabs = [
    { href: basePath, label: "Members" },
    { href: `${basePath}/roles`, label: "Roles" },
  ];

  return (
    <nav className="-mb-px flex gap-6 border-b">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-2 text-sm transition-colors",
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
