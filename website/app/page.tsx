import type { Metadata } from "next";
import { deploymentBasePath, productionUrl } from "@/lib/shared";

export const metadata: Metadata = {
  alternates: {
    canonical: `${productionUrl}/docs/`,
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function Page() {
  const docsUrl = `${deploymentBasePath}/docs/`;

  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${docsUrl}`} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.location.replace(${JSON.stringify(docsUrl)});`,
        }}
      />
      <noscript>
        <a href={docsUrl}>Open GrantTrace documentation</a>
      </noscript>
    </>
  );
}
