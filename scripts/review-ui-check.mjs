import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? "http://127.0.0.1:3000";
const identity = process.env.UI_AUDIT_IDENTITY ?? process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.UI_AUDIT_PASSWORD ?? process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD;

if (!identity || !password) throw new Error("UI review credentials are required.");

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
const page = await context.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
mkdirSync("artifacts/review-ui", { recursive: true });

async function signIn() {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  if (new URL(page.url()).pathname !== "/login") return;
  await page.getByPlaceholder("Email или телефон").fill(identity);
  await page.getByPlaceholder("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти в CRM", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function open(path) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200, `${path} must return HTTP 200`);
}

function centerY(rect) {
  return rect.y + rect.height / 2;
}

try {
  await signIn();

  await open("/");
  assert.equal(await page.locator(".dashboard-anchor-nav").count(), 0, "Dashboard anchor navigation must be removed");
  assert.equal(await page.getByText("Часовой пояс компании", { exact: true }).count(), 0, "Timezone caption must be removed");
  assert.match(await page.locator(".dashboard-date-card time").innerText(), /^\d{2}:\d{2} · Москва$/, "Dashboard must show Moscow time");
  const dateStyle = await page.locator(".dashboard-date-card").evaluate((element) => ({ border: getComputedStyle(element).borderTopWidth, background: getComputedStyle(element).backgroundColor }));
  assert.equal(dateStyle.border, "0px", "Date widget must not have a border");
  assert.equal(dateStyle.background, "rgba(0, 0, 0, 0)", "Date widget must be transparent");
  assert.equal(await page.getByRole("link", { name: "Все выезды ↗" }).count(), 0, "Duplicate visits action must be removed");
  assert.equal(await page.getByText(/пунктир — среднее/).count(), 0, "Activity average legend must be removed");
  assert.equal(await page.locator(".dashboard-activity-card a[href='/analytics']").count(), 0, "Activity analytics action must be removed");
  const metricBorders = await page.locator(".dashboard-open-metrics article").evaluateAll((elements) => elements.map((element) => parseFloat(getComputedStyle(element).borderTopWidth)));
  assert.ok(metricBorders.every((width) => width > 0), "Every dashboard KPI must be boxed");
  const footerOffsets = await page.locator(".dashboard-open-metrics article").evaluateAll((elements) => elements.map((element) => {
    const card = element.getBoundingClientRect();
    const footer = element.querySelector(".dashboard-metric-footer")?.getBoundingClientRect();
    return footer ? Math.round(card.bottom - footer.bottom) : null;
  }));
  assert.ok(footerOffsets.every((offset) => offset !== null && Math.abs(offset - footerOffsets[0]) <= 1), "Dashboard KPI footers must share one bottom baseline");
  const taskPanel = await page.locator(".dashboard-task-panel").boundingBox();
  const taskBody = await page.locator(".dashboard-task-cards").boundingBox();
  const taskLink = await page.locator(".dashboard-task-all-link").boundingBox();
  assert.ok(taskPanel && taskLink && Math.abs(taskPanel.y + taskPanel.height - (taskLink.y + taskLink.height)) <= 8, "All tasks action must stay at the panel bottom");
  assert.ok(taskBody && taskLink && Math.abs(taskBody.y + taskBody.height - taskLink.y) <= 1, "Task content must fill the panel and connect to its bottom action");
  const calendarPanel = await page.locator(".dashboard-calendar-panel").boundingBox();
  const calendarBody = await page.locator(".dashboard-calendar-body").boundingBox();
  const calendarVisits = await page.locator(".dashboard-calendar-visits").boundingBox();
  const calendarLink = await page.locator(".dashboard-calendar-panel > a").boundingBox();
  assert.ok(calendarPanel && calendarLink && Math.abs(calendarPanel.y + calendarPanel.height - (calendarLink.y + calendarLink.height)) <= 8, "Calendar action must stay at the panel bottom");
  assert.ok(calendarBody && calendarLink && Math.abs(calendarBody.y + calendarBody.height - calendarLink.y) <= 1, "Calendar content must fill the panel and connect to its bottom action");
  assert.ok(calendarBody && calendarVisits && calendarBody.y + calendarBody.height - (calendarVisits.y + calendarVisits.height) <= 17, "Calendar visit surface must fill the available body height");
  const dashboardPanelRadii = await page.locator(".dashboard-operational-row .dashboard-panel").evaluateAll((panels) => panels.map((panel) => {
    const panelStyle = getComputedStyle(panel);
    const firstSection = panel.firstElementChild;
    const firstSectionStyle = firstSection ? getComputedStyle(firstSection) : null;
    return {
      panelTopLeft: Number.parseFloat(panelStyle.borderTopLeftRadius),
      panelTopRight: Number.parseFloat(panelStyle.borderTopRightRadius),
      innerTopLeft: Number.parseFloat(firstSectionStyle?.borderTopLeftRadius ?? "0"),
      innerTopRight: Number.parseFloat(firstSectionStyle?.borderTopRightRadius ?? "0"),
    };
  }));
  assert.ok(dashboardPanelRadii.every((radii) => Object.values(radii).every((radius) => radius > 0)), "Dashboard panels and their header layers must keep rounded top corners");
  const dashboardInnerGroups = await page.locator(".dashboard-panel").evaluateAll((panels) => panels.map((panel) => {
    const panelBackground = getComputedStyle(panel).backgroundColor;
    const sections = Array.from(panel.children)
      .slice(1)
      .filter((section) => getComputedStyle(section).display !== "none")
      .map((section) => {
        const style = getComputedStyle(section);
        const bounds = section.getBoundingClientRect();
        return {
          radii: [
            Number.parseFloat(style.borderTopLeftRadius),
            Number.parseFloat(style.borderTopRightRadius),
            Number.parseFloat(style.borderBottomRightRadius),
            Number.parseFloat(style.borderBottomLeftRadius),
          ],
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          background: style.backgroundColor,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      });
    return { panelBackground, sections };
  }));
  assert.ok(dashboardInnerGroups.every(({ sections }) => sections.length > 0), "Dashboard panels must expose inner content sections");
  assert.ok(
    dashboardInnerGroups.every(({ sections }) => sections[0].radii[0] >= 15 && sections[0].radii[1] >= 15),
    "The first dashboard content section must keep rounded top corners",
  );
  assert.ok(
    dashboardInnerGroups.every(({ sections }) => sections.length === 1 || (sections[0].radii[2] === 0 && sections[0].radii[3] === 0)),
    "The first dashboard content section must connect to the content below without rounded lower corners",
  );
  assert.ok(
    dashboardInnerGroups.every(({ sections }) => sections.slice(1).every(({ radii }) => radii[0] === 0 && radii[1] === 0)),
    "Only the first dashboard content section may have rounded top corners",
  );
  assert.ok(
    dashboardInnerGroups.every(({ panelBackground, sections }) => sections.every(({ background }) => background !== panelBackground)),
    "Dashboard panel frames must contrast with inner sections so rounded corners remain visible",
  );
  assert.ok(
    dashboardInnerGroups.every(({ sections }) => sections.every(({ overflowX, overflowY }) => overflowX !== "visible" && overflowY !== "visible")),
    "Dashboard inner sections must clip child backgrounds to their outer rounded corners",
  );
  assert.ok(
    dashboardInnerGroups.every(({ sections }) => sections.length < 2 || Math.abs(sections[1].top - sections[0].bottom) <= 1),
    "Dashboard top content sections must remain connected without visual gaps",
  );
  await page.screenshot({ path: "artifacts/review-ui/dashboard-desktop.png", fullPage: true });

  await open("/tasks");
  assert.equal(await page.locator(".tasks-column-tabs").count(), 0, "Task deadline navigation must be removed");
  assert.equal(await page.locator(".tasks-group.figma-report-panel").count(), 4, "Task deadline groups must be separate panels");
  const queueOverflow = await page.locator(".tasks-queue").evaluate((element) => getComputedStyle(element).overflowY);
  assert.equal(queueOverflow, "visible", "The task queue container must not own the task-list scrolling");
  const groupLists = await page.locator(".tasks-group-list").evaluateAll((lists) => lists.map((list) => ({
    client: list.clientHeight,
    scroll: list.scrollHeight,
    overflowY: getComputedStyle(list).overflowY,
  })));
  assert.ok(groupLists.length > 0 && groupLists.every(({ client, overflowY }) => overflowY === "auto" && client <= 560), "Every populated task group must own a bounded internal scroller");
  const upcomingList = await page.locator("#tasks-upcoming-list").evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  assert.ok(upcomingList.scroll > upcomingList.client, "The long upcoming-task group must scroll inside its own card");
  assert.equal(await page.getByRole("button", { name: /Показать ещё/ }).count(), 0, "Task groups must not expand the page");
  const openLabels = await page.locator(".tasks-row-open").allTextContents();
  assert.ok(openLabels.length > 0 && openLabels.every((label) => label.trim() === "Открыть"), "Task open actions must not include arrow icons");
  await page.screenshot({ path: "artifacts/review-ui/tasks-desktop.png", fullPage: true });

  await open("/masters");
  const firstMaster = page.locator("article[role='link']").first();
  const identity = firstMaster.locator("div.grid.grid-cols-\\[2\\.75rem_minmax\\(0\\,1fr\\)\\]");
  const avatar = identity.locator("span.rounded-full").first();
  const identityRect = await identity.boundingBox();
  const avatarRect = await avatar.boundingBox();
  assert.ok(identityRect && avatarRect && Math.abs(centerY(identityRect) - centerY(avatarRect)) <= 2, "Master avatar must be vertically centered in the identity block");

  await open("/contracts");
  await page.getByText(/Доп\. соглашение LOCAL-DEMO-2026-00[12]/).first().waitFor();
  const linkButton = page.getByRole("button", { name: /Связать договор LOCAL-DEMO-2026/ }).first();
  await linkButton.click();
  const relationDialog = page.getByRole("dialog", { name: "Связать договор" });
  await relationDialog.waitFor();
  assert.ok(await relationDialog.locator("select[name='relatedContractId'] option").count() >= 1, "Contract relation dialog must expose available contracts");
  await relationDialog.getByRole("button", { name: "Закрыть окно" }).click();

  await open("/sites");
  const filterStyle = await page.locator(".sites-filter-button").evaluate((element) => ({ whiteSpace: getComputedStyle(element).whiteSpace, height: element.getBoundingClientRect().height, scrollHeight: element.scrollHeight }));
  assert.equal(filterStyle.whiteSpace, "nowrap", "Site filter text must not wrap");
  assert.ok(filterStyle.scrollHeight <= filterStyle.height + 1, "Site filter content must fit on one line");
  assert.match(await page.locator(".sites-funnel-shape > span").evaluate((element) => getComputedStyle(element).clipPath), /40\.25%.*59\.75%/, "Funnel segments must meet at the same height");
  const siteHref = await page.locator(".sites-register-domain a").first().getAttribute("href");
  assert.ok(siteHref?.startsWith("/sites/"), "Site detail link is required");
  await open(siteHref);
  assert.equal(await page.getByText("Запись активна", { exact: true }).count(), 0, "Obsolete site status label must be removed");
  assert.equal(await page.getByText(/Мониторинг не подключён/).count(), 0, "Obsolete monitoring note must be removed");
  await page.getByText("Подключено", { exact: true }).waitFor();
  assert.ok(await page.locator(".site-detail-response .recharts-cartesian-grid-horizontal line").count() > 0, "Response chart must render horizontal grid lines");
  const firstPoint = page.locator(".site-detail-response .recharts-line-dots circle").first();
  const pointRect = await firstPoint.boundingBox();
  assert.ok(pointRect, "Response chart point must be measurable");
  await page.mouse.move(pointRect.x + pointRect.width / 2, pointRect.y + pointRect.height / 2);
  await page.locator(".site-health-tooltip").waitFor({ state: "visible" });
  await page.screenshot({ path: "artifacts/review-ui/site-tooltip.png" });
  const tooltip = await page.locator(".site-health-tooltip").textContent();
  assert.match(tooltip, /Ответ\s*:\s*\d+ мс/, "Response tooltip must show the measured value");
  const historyDateColor = await page.locator(".site-detail-history article span").first().evaluate((element) => getComputedStyle(element).color);
  assert.notEqual(historyDateColor, "rgb(112, 115, 123)", "History dates must use stronger contrast");
  await page.screenshot({ path: "artifacts/review-ui/site-detail-desktop.png", fullPage: true });

  for (const path of ["/", "/tasks", "/analytics", "/sites", siteHref]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(path);
    const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.ok(widths.document <= widths.viewport + 1, `${path} must not overflow at 390px`);
  }

  assert.deepEqual(browserErrors, [], "Reviewed pages must not emit browser errors");
  console.log("Dashboard, tasks, masters, contracts and sites review checks passed.");
} finally {
  await context.close();
  await browser.close();
}
