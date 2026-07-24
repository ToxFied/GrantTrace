import { getPageMarkdownUrl, source } from "@/lib/source";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { notFound } from "next/navigation";
import { DocsLink, getMDXComponents } from "@/components/mdx";
import type { Metadata } from "next";
import {
  productionUrl,
  repositoryBranch,
  repositoryUrl,
} from "@/lib/shared";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage
      id="nd-page"
      role="main"
      tabIndex={-1}
      toc={page.data.toc}
      full={page.data.full}
      breadcrumb={{ enabled: false }}
      tableOfContent={{ style: "clerk" }}
      tableOfContentPopover={{ style: "clerk" }}
    >
      <DocsTitle className="text-balance text-[2rem] font-semibold tracking-[-0.04em]">
        {page.data.title}
      </DocsTitle>
      <DocsDescription className="mb-0 mt-1 max-w-2xl text-base leading-7">
        {page.data.description}
      </DocsDescription>
      <div className="flex items-center gap-2 border-b border-fd-border pb-7 pt-1">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`${repositoryUrl}/blob/${repositoryBranch}/docs/${page.path}`}
        />
      </div>
      <DocsBody className="max-w-none [&>h2]:mt-12 [&>h2]:border-b [&>h2]:border-fd-border [&>h2]:pb-2 [&>h2]:tracking-[-0.025em] [&>h3]:mt-8 [&>h3]:tracking-[-0.015em]">
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page, DocsLink),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<"/docs/[[...slug]]">,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: {
      canonical: `${productionUrl}${page.url}`,
    },
    openGraph: {
      title: `${page.data.title} · GrantTrace`,
      description: page.data.description,
      url: `${productionUrl}${page.url}`,
      type: "article",
    },
  };
}
