"use client";

import SearchDialog from "@/components/search";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      search={{
        SearchDialog,
        links: [
          ["Quickstart", "/docs/getting-started"],
          ["CLI", "/docs/cli-reference"],
          ["Troubleshooting", "/docs/troubleshooting"],
        ],
      }}
    >
      {children}
    </RootProvider>
  );
}
