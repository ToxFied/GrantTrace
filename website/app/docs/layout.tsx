import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      sidebar={{
        "aria-label": "Documentation",
        footer: (
          <div
            key="version"
            className="flex items-center gap-2 px-1 text-xs text-fd-muted-foreground"
          >
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-fd-foreground/60 shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-fd-foreground)_10%,transparent)]"
            />
            GrantTrace 0.1 beta
          </div>
        ),
      }}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
