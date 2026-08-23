import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono, Nunito_Sans } from "next/font/google";
import "./globals.css";
import { UmamiAnalytics } from "@/components/analytics/umami-analytics";
import { DevNavigationDebug } from "@/components/dev-navigation-debug";
import { DevServiceWorkerCleanup } from "@/components/dev-sw-cleanup";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const isDev = process.env.NODE_ENV === "development";

const nunitoSans = Nunito_Sans({ subsets: ["latin"], variable: "--font-sans" });

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

const APP_NAME = "Sprintify";
const APP_TITLE = "Sprintify — Make every sprint feel possible";
const APP_DESCRIPTION =
  "Sprintify brings your plans, progress, and people into one beautifully simple place.";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f6" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c0e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        nunitoSans.variable,
        notoSansMono.variable,
      )}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {isDev && <DevServiceWorkerCleanup />}
        {isDev && <DevNavigationDebug />}
        <SerwistProvider swUrl="/serwist/sw.js" disable={isDev}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
          </ThemeProvider>
        </SerwistProvider>
        <UmamiAnalytics />
      </body>
    </html>
  );
}
