import { expect, test } from '@playwright/test';

const ROUTES_TO_CHECK = [
  '/billing/charge-capture',
  '/billing/claims',
];

const FATAL_TEXT_PATTERNS = [
  /Application error/i,
  /Unhandled Runtime Error/i,
  /Internal Server Error/i,
  /could not find the table/i,
  /schema cache/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
];

test('THERASSISTANT billing pages load without fatal runtime errors', async ({
  page,
}, testInfo) => {
  const problems: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  const routeSnapshots: Record<string, unknown> = {};

  page.on('pageerror', error => {
    pageErrors.push(error.message);
  });

  page.on('response', response => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const route of ROUTES_TO_CHECK) {
    const response = await page.goto(route, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {
      problems.push(`${route}: page did not finish loading`);
    });

    const status = response?.status() ?? null;

    const bodyText = await page
      .locator('body')
      .innerText({ timeout: 10_000 })
      .catch(() => '');

    const normalizedBodyText = bodyText.replace(/\s+/g, ' ').trim();

    routeSnapshots[route] = {
      status,
      finalUrl: page.url(),
      bodyPreview: normalizedBodyText.slice(0, 3000),
    };

    await testInfo.attach(
      `${route.replace(/^\/+/, '').replace(/\//g, '_')}.png`,
      {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      },
    );

    if (status === null) {
      problems.push(`${route}: no HTTP response`);
    } else if (status === 404) {
      problems.push(`${route}: route returned 404`);
    } else if (status >= 500) {
      problems.push(`${route}: route returned HTTP ${status}`);
    }

    for (const pattern of FATAL_TEXT_PATTERNS) {
      if (pattern.test(normalizedBodyText)) {
        problems.push(`${route}: page text matched ${String(pattern)}`);
      }
    }
  }

  if (pageErrors.length > 0) {
    problems.push(`Browser runtime errors: ${pageErrors.join(' | ')}`);
  }

  if (serverErrors.length > 0) {
    problems.push(`Server/API errors: ${serverErrors.join(' | ')}`);
  }

  await testInfo.attach('therassistant-diagnostics.json', {
    body: JSON.stringify(
      {
        problems,
        pageErrors,
        serverErrors,
        routeSnapshots,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });

  expect(problems, problems.join('\n')).toEqual([]);
});