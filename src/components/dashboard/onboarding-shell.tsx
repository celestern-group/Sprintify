import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <header className="flex h-11.5 items-center justify-end gap-2 border-b px-3">
        <ThemeToggle />
        <SignOutButton />
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
