import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import {
  appName,
  deploymentBasePath,
  docsRoute,
  repositoryUrl,
} from "./shared";

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <img
        aria-hidden="true"
        src={`${deploymentBasePath}/granttrace-mark.svg`}
        className="size-6"
        width="24"
        height="24"
        alt=""
      />
      <span className="tracking-[-0.02em]">{appName}</span>
      <span className="rounded-md border bg-fd-secondary/70 px-1.5 py-0.5 font-mono text-[0.62rem] font-medium uppercase tracking-[0.12em] text-fd-muted-foreground">
        docs
      </span>
    </span>
  );
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Brand />,
      url: docsRoute,
    },
    githubUrl: repositoryUrl,
  };
}
