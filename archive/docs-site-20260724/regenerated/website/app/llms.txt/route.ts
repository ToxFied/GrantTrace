import { source } from "@/lib/source";

export const revalidate = false;

export function GET() {
  const groups = source.getPageTree().children;
  const lines = [
    "# GrantTrace",
    "",
    "> Scenario-bound GitHub App permission contracts.",
    "",
  ];

  for (const item of groups) {
    if (item.type === "separator") {
      lines.push(`- **${item.name}**`);
      continue;
    }
    if (item.type !== "page") continue;
    const description = item.description ? `: ${item.description}` : "";
    lines.push(`- [${item.name}](${item.url})${description}`);
  }

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
