import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/session";

export default async function Home() {
  const session = await getSession();

  if (session) {
    redirect("/app");
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-background px-6">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <div className="flex flex-col items-center gap-6 text-center">
        <Image
          src="/logos/sprintify-logo.svg"
          alt="Sprintify"
          width={160}
          height={40}
          className="h-8 w-auto dark:hidden"
          priority
        />
        <Image
          src="/logos/sprintify-logo-white.svg"
          alt="Sprintify"
          width={160}
          height={40}
          className="hidden h-8 w-auto dark:block"
          priority
        />
        <Badge variant="secondary">Coming Soon</Badge>
        <h1 className="max-w-xl font-heading text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
          Something new is on the way.
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          We&apos;re putting the finishing touches on it. Check back soon.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/sign-in">Log in</Link>}
          />
        </div>
      </div>
    </div>
  );
}
