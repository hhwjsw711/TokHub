import { expect, test, type Page } from "@playwright/test";
import type { PublicChannel } from "../web/src/lib/api";

test("public dashboard refreshes the 24-hour trend without changing the range", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByRole("columnheader", { name: "近24h趋势" })).toBeVisible();

  const refresh = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/public/channels"
        && url.searchParams.get("range") === "24";
    },
    { timeout: 12_000 }
  );

  await expect(refresh).resolves.toBeTruthy();
});

test("brand trend uses the same primary channel data as its preview", async ({ page }) => {
  const fixture = await loadChannelFixture(page);
  const primary = withTrend(fixture, "trend-source-primary", "Trend Source", 95);
  const secondary = withTrend(fixture, "trend-source-secondary", "Trend Source", 0);
  await routeChannels(page, [primary, secondary]);

  await page.goto("/dashboard", { waitUntil: "networkidle" });
  const row = page.locator("tr.channel-click-row").filter({ hasText: "Trend Source" });
  await expect(row.locator(".tk-trend-bars i").first()).toHaveClass(/ok/);

  await row.click();
  await expect(page.getByRole("dialog", { name: "Trend Source" }).locator(".heat i").first()).not.toHaveClass(/down|warn|na/);
});

test("open preview updates when the public channel poll returns a newer probe", async ({ page }) => {
  const fixture = await loadChannelFixture(page);
  let calls = 0;
  await page.route("**/api/public/channels?**", async (route) => {
    calls += 1;
    const value = calls === 1 ? 95 : 0;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [withTrend(fixture, "preview-refresh", "Preview Refresh", value)], total: 1, page: 1, pageSize: 100 })
    });
  });

  await page.goto("/dashboard", { waitUntil: "networkidle" });
  const row = page.locator("tr.channel-click-row").filter({ hasText: "Preview Refresh" });
  await row.click();
  const dialog = page.getByRole("dialog", { name: "Preview Refresh" });
  await expect(dialog.locator(".heat i").first()).not.toHaveClass(/down|warn|na/);

  const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/public/channels");
  await refresh;
  await expect(dialog.locator(".heat i").first()).toHaveClass(/down/);
});

async function loadChannelFixture(page: Page): Promise<PublicChannel> {
  const response = await page.request.get("/api/public/channels?page=1&pageSize=1&range=24");
  const payload = await response.json() as { items: PublicChannel[] };
  if (!payload.items[0]) throw new Error("public channel fixture is unavailable");
  return payload.items[0];
}

async function routeChannels(page: Page, channels: PublicChannel[]) {
  await page.route("**/api/public/channels?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: channels, total: channels.length, page: 1, pageSize: 100 })
    });
  });
}

function withTrend(base: PublicChannel, id: string, provider: string, value: number): PublicChannel {
  const trendBuckets = Array.from({ length: 24 }, (_, index) => ({
    key: `2026-07-12T${String(index).padStart(2, "0")}:00:00Z`,
    label: `${String(index).padStart(2, "0")}:00`,
    value
  }));
  return {
    ...base,
    id,
    publicSlug: id,
    name: `${provider} · ${id}`,
    provider,
    model: id,
    upstreamModel: id,
    trend: Array.from({ length: 24 }, () => value),
    trendBuckets
  };
}
