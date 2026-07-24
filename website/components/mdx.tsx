import defaultMdxComponents from "fumadocs-ui/mdx";
import { Step, Steps } from "fumadocs-ui/components/steps";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { docsRoute } from "@/lib/shared";

function normalizeDocsHref(href: string | undefined) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/|#)/i.test(href)) {
    return href;
  }

  const sourceLink = href.match(
    /^(?:\.\/)?([^/]+)\.(?:md|mdx)([?#].*)?$/i,
  );
  if (!sourceLink) return href;

  return `${docsRoute}/${sourceLink[1]}${sourceLink[2] ?? ""}`;
}

export function DocsLink(props: ComponentProps<"a">) {
  const Link = defaultMdxComponents.a;

  return <Link {...props} href={normalizeDocsHref(props.href)} />;
}

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Step,
    Steps,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
