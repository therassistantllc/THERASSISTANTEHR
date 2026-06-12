import { test, expect } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173';

const ROUTES_TO_CHECK = [
  '/',
  '/billing/charge-capture',
  '/billing/claims',
  '/billing/837p',
];

const HARD_FAILURE_PATTERNS = [
  /could not find the table/i,
  /schema cache/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /failed to fetch/i,
  /supabase/i,
  /missing diagnosis/i,
  /missing service code/i,
  /missing procedure code/i,
  /draft/i,
  /on hold/i,
];

test('THERASSISTANT app routes should not expose schema or claim workflow errors', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const routeSnapshots: Record<string, string> = {};

  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  page.on('requestfailed', request => {
    failedRequests.push(
      `${request.method()} ${request.url()} :: ${
        request.failure()?.errorText ?? 'unknown request failure'
      }`
    );
  });

  page.on('response', response => {
    const status = response.status();
    const url = response.url();

    if (status >= 500) {
      failedRequests.push(`${status} ${url}`);
    }
  });

  for (const route of ROUTES_TO_CHECK) {
    const url = new URL(route, BASE_URL).toString();

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      problems.push(`${route}: page did not reach networkidle`);
    });

    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 10000 })
      .catch(() => '');

    const normalizedText = bodyText.replace(/\s+/g, ' ').trim();
    routeSnapshots[route] = normalizedText.slice(0, 5000);

    await testInfo.attach(
      `${route === '/' ? 'home' : route.replaceAll('/', '_')}.png`,
      {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      }
    );

    for (const pattern of HARD_FAILURE_PATTERNS) {
      if (pattern.test(normalizedText)) {
        problems.push(`${route}: visible page text matched ${String(pattern)}`);
      }
    }
  }

  if (pageErrors.length > 0) {
    problems.push(`Browser page errors: ${pageErrors.join(' | ')}`);
  }

  if (consoleErrors.length > 0) {
    problems.push(`Console errors: ${consoleErrors.join(' | ')}`);
  }

  if (failedRequests.length > 0) {
    problems.push(`Failed/server requests: ${failedRequests.join(' | ')}`);
  }

  await testInfo.attach('therassistant-route-snapshots.json', {
    body: JSON.stringify(routeSnapshots, null, 2),
    contentType: 'application/json',
  });

  await testInfo.attach('therassistant-diagnostics.json', {
    body: JSON.stringify(
      {
        problems,
        consoleErrors,
        pageErrors,
        failedRequests,
      },
      null,
      2
    ),
    contentType: 'application/json',
  });

  expect(problems, problems.join('\n')).toEqual([]);
});