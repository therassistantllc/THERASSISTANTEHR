import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const appRoot = join(root, "artifacts/therassistant-ehr/app");
const sidebarPath = join(root, "artifacts/therassistant-ehr/components/layout/AppSidebarNav.tsx");

function routeExists(route: string): boolean {
  if (route === "/") return existsSync(join(appRoot, "page.tsx"));

  const rel = route.replace(/^\/+/, "");
  return (
    existsSync(join(appRoot, rel, "page.tsx")) ||
    existsSync(join(appRoot, rel, "route.ts"))
  );
}

function main() {
  if (!existsSync(sidebarPath)) {
    throw new Error(`Sidebar file not found: ${sidebarPath}`);
  }

  const source = readFileSync(sidebarPath, "utf8");
  const hrefs = [...new Set([...source.matchAll(/href="([^"]+)"/g)].map((m) => m[1]))];

  let failures = 0;

  console.log("NAV HREF CHECK");

  for (const href of hrefs.sort()) {
    const ok = routeExists(href);
    console.log(`${ok ? "OK  " : "MISS"} ${href}`);
    if (!ok) failures++;
  }

  if (failures > 0) {
    throw new Error(`${failures} navigation href(s) point to missing routes.`);
  }

  console.log("\nRoute audit passed.");
}

main();