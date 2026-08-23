"use client";

import { IconMoon, IconSun } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => {
        const next = resolvedTheme === "dark" ? "light" : "dark";
        trackEvent("ui.theme_toggle", { to: next });
        setTheme(next);
      }}
    >
      {mounted && resolvedTheme === "dark" ? <IconSun /> : <IconMoon />}
    </Button>
  );
}
