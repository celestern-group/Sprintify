import Image from "next/image";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AuthShell({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
      <div className="absolute top-6 right-6">
        <ThemeToggle />
      </div>
      <div className="flex w-full max-w-md flex-col items-center gap-8">
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
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-3xl font-extrabold tracking-tight">
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
          <CardFooter className="justify-center">{footer}</CardFooter>
        </Card>
      </div>
    </div>
  );
}
