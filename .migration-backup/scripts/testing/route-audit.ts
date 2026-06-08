import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const appRoot = join(root, "artifacts/therassistant-ehr/app");
const sidebarPath = join(root, "artifacts/therassistant-ehr/components/layout/AppSidebarNav.tsx");
const settingsPagePath = join(root, "artifacts/therassistant-ehr/app/settings/page.tsx");

function routeExists(route: string): boolean {
  if (!route.startsWith("/")) return true;
  if (route === "/") return existsSync(join(appRoot, "page.tsx"));

  const rel = route.replace(/^\/+/, "");
  return existsSync(join(appRoot, rel, "page.tsx")) || existsSync(join(appRoot, rel, "route.ts"));
}

function extractRoutes(source: string): string[] {
  const hrefs = [...source.matchAll(/href=\"([^\"]+)\"/g)].map((match) => match[1]);
  const literalHrefs = [...source.matchAll(/href:\s*\"([^\"]+)\"/g)].map((match) => match[1]);
  return [...new Set([...hrefs, ...literalHrefs])].sort();
}

function auditFile(label: string, path: string): number {
  if (!existsSync(path)) {
    console.warn(`SKIP ${label}: ${path} not found`);
    return 0;
  }

  const source = readFileSync(path, "utf8");
  const routes = extractRoutes(source);
  let failures = 0;

  console.log(`\n${label}`);
  for (const route of routes) {
    const ok = routeExists(route);
    console.log(`${ok ? "OK  " : "MISS"} ${route}`);
    if (!ok) failures += 1;
  }

  return failures;
}

function main() {
  let failures = 0;
  failures += auditFile("SIDEBAR ROUTE CHECK", sidebarPath);
  failures += auditFile("SETTINGS LANDING ROUTE CHECK", settingsPagePath);

  if (failures > 0) {
    throw new Error(`${failures} route target(s) point to missing pages or route handlers.`);
  }

  console.log("\nRoute audit passed.");
}

main();
