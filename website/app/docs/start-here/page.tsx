"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const quickstartPath = "/docs/getting-started";

/** Keeps old beginner-guide links working after its content moved to Quickstart. */
export default function StartHereRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace(quickstartPath);
  }, [router]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p>
        This guide moved to <a href={quickstartPath}>Quickstart</a>.
      </p>
    </main>
  );
}
