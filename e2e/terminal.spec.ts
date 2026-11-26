import { expect, test } from "@playwright/test";

test("disconnected terminal makes no account claims and has navigable controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Portfolio Overview" }),
  ).toBeVisible();
  await expect(page.getByText("PAPER MODE", { exact: true })).toBeVisible();
  await expect(page.getByText("Terminal is disconnected")).toBeVisible();
  await expect(page.getByText("No equity snapshots available")).toBeVisible();
  await page.getByRole("button", { name: "Risk Management" }).click();
  await expect(
    page.getByRole("button", { name: "Emergency stop" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Connect terminal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("authenticated UI renders API state and sends emergency stop to backend", async ({
  page,
}) => {
  const key = "test-operator-key-for-browser-fixture";
  let stopped = false;
  await page.route("**/terminal-api/overview", (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${key}`);
    return route.fulfill({
      json: {
        mode: "paper",
        state: { stopped, reason: stopped ? "Operator stop" : "Armed" },
        bots: [],
        intents: [],
        signals: [],
        equity: [],
        heartbeat: null,
        audit: [],
        broker: {
          account: {
            equity: "12500",
            last_equity: "12400",
            buying_power: "4550",
          },
          positions: [],
        },
      },
    });
  });
  await page.route("**/terminal-api/control", (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "stop" });
    stopped = true;
    return route.fulfill({ json: { stopped } });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect terminal", exact: true })
    .click();
  await page.getByLabel("Operator key").fill(key);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("$12,500.00")).toBeVisible();
  await page.getByRole("button", { name: "Risk Management" }).click();
  await page.getByRole("button", { name: "Emergency stop" }).click();
  await expect(page.getByText("Operator stop", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Terminal is disconnected")).toBeVisible();
});
