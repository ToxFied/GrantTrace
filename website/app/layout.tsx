import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Provider } from "@/components/provider";
import { deploymentBasePath, productionUrl } from "@/lib/shared";
import "./global.css";

const sans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl),
  title: {
    default: "GrantTrace Docs",
    template: "%s · GrantTrace",
  },
  description:
    "See which GitHub App permissions each tested behavior actually uses, with evidence that stays reviewable in Git.",
  icons: {
    icon: [
      {
        url: `${deploymentBasePath}/granttrace-mark.svg`,
        type: "image/svg+xml",
      },
    ],
  },
  openGraph: {
    title: "GrantTrace Docs",
    description:
      "See which GitHub App permissions each tested behavior actually uses, with evidence that stays reviewable in Git.",
    type: "website",
    siteName: "GrantTrace Docs",
  },
  twitter: {
    card: "summary",
    title: "GrantTrace Docs",
    description:
      "See which GitHub App permissions each tested behavior actually uses, with evidence that stays reviewable in Git.",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#080808" },
  ],
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <a
          href="#nd-page"
          className="fixed start-4 top-4 z-50 -translate-y-20 rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-fd-ring focus:ring-offset-2 focus:ring-offset-fd-background"
        >
          Skip to documentation
        </a>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
