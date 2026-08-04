import { expect, test } from "@playwright/test";

test("channel detail uses dashboard ranges and refreshes its trend", async ({ page }) => {
  let trendRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/public/channels/4a4941c2" && url.searchParams.get("range") === "30") trendRequests += 1;
  });

  await page.goto("/channels/4a4941c2", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "近24h" })).toBeVisible();
  await expect(page.getByRole("button", { name: "近7天" })).toBeVisible();
  await expect(page.getByRole("button", { name: "近30天" })).toBeVisible();
  await expect(page.getByRole("button", { name: "全量" })).toBeVisible();
  await expect(page.locator(".detail-line .area")).toHaveCount(0);

  const refresh = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/public/channels/4a4941c2"
      && url.searchParams.get("range") === "30";
  }, { timeout: 12_000 });
  await expect(refresh).resolves.toBeTruthy();

  const sevenDay = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/public/channels/4a4941c2"
      && url.searchParams.get("range") === "7";
  });
  await page.getByRole("button", { name: "近7天" }).click();
  await expect(sevenDay).resolves.toBeTruthy();
  await expect(page.locator(".channel-rank-metrics").getByText("近7天可用率")).toBeVisible();
  await expect(page.locator(".ticker").getByText("近7天可用率")).toBeVisible();
  await expect(page.locator(".detail-dkpis").getByText("近7天可用率")).toBeVisible();
  await expect(page.locator(".detail-dkpis").getByText("近7天窗口")).toHaveCount(2);
  await expect(page.locator(".q-index .chg")).toContainText("上个8小时");
});
