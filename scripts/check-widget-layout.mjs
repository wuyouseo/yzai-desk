import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const localBrowsers = `${homedir()}/AppData/Local/ms-playwright`;
if ((!process.env.PLAYWRIGHT_BROWSERS_PATH || !existsSync(process.env.PLAYWRIGHT_BROWSERS_PATH)) && existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;

const modulePath = process.env.PLAYWRIGHT_MODULE || "C:/Users/123/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(pathToFileURL(modulePath).href);
let executablePath = process.env.WIDGET_CHROMIUM_PATH || chromium.executablePath();
if (!existsSync(executablePath) && existsSync(localBrowsers)) {
  const cached = (await readdir(localBrowsers)).filter((name) => /^chromium_headless_shell-\d+$/.test(name)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  for (const folder of cached) { const candidate = `${localBrowsers}/${folder}/chrome-headless-shell-win64/chrome-headless-shell.exe`; if (existsSync(candidate)) { executablePath = candidate; break; } }
}
const browser = await chromium.launch({ headless: true, executablePath });
const output = new URL("../docs/verification/widgets/", import.meta.url);
await mkdir(output, { recursive: true });
const cases = {
  calendar: [[260, 300], [280, 340], [320, 380], [420, 460], [600, 300]],
  focus: [[260, 220], [280, 240], [320, 320], [380, 400], [416, 546], [600, 240], [260, 600]],
  note: [[250, 210], [280, 220], [320, 300], [420, 440]],
  weather: [[260, 150], [320, 180], [380, 240], [500, 300]],
};
const results = [];
try {
  for (const [kind, sizes] of Object.entries(cases)) for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-08-01T10:00:00+08:00") });
    if (!process.env.WIDGET_TEST_URL) await page.route("http://widget.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const file = new URL(`../dist${pathname === "/" ? "/index.html" : pathname}`, import.meta.url);
      assert.ok(file.href.startsWith(new URL("../dist/", import.meta.url).href));
      const ext = pathname.split(".").pop();
      await route.fulfill({ body: await readFile(file), contentType: ({ js: "text/javascript", css: "text/css", png: "image/png" })[ext] || "text/html" });
    });
    await page.route("https://api.open-meteo.com/**", (route) => route.fulfill({ json: { current: { temperature_2m: 26, apparent_temperature: 28, weather_code: 1, wind_speed_10m: 8 } } }));
    await page.addInitScript(() => localStorage.setItem("yzai-desk-preview", JSON.stringify({ events: [], notes: [], settings: { theme: "cloud", pomo_duration: 240, weather_city: "内蒙古自治区呼和浩特市" } })));
    await page.goto(`${process.env.WIDGET_TEST_URL || "http://widget.test"}/#/mini-widget/${kind}`);
    await page.locator(".mini-widget-root").waitFor();
    await page.waitForTimeout(100);
    const inspect = () => page.evaluate(() => {
      const selectors = ".mini-widget-header, .mini-calendar-grid button, .standalone-note textarea, .standalone-note small, .standalone-focus-ring strong, .standalone-focus-ring span, .standalone-focus button, .standalone-focus input, .weather-main, .weather-details, .standalone-weather time";
      return [...document.querySelectorAll(selectors)].flatMap((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return [];
        return r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 ? [{ text: el.textContent?.trim().slice(0, 30), x: r.x, y: r.y, w: r.width, h: r.height }] : [];
      });
    });
    const clipped = await inspect();
    if (kind === "calendar") assert.equal(await page.locator(".mini-calendar-grid button").count(), 31, "six-row month retains all dates");
    if (kind === "focus") {
      await page.getByRole("button", { name: "自定义", exact: true }).click();
      await page.getByLabel("自定义专注分钟数").fill("0");
      await page.getByRole("button", { name: "确定", exact: true }).click();
      clipped.push(...await inspect());
      const collision = await page.evaluate(() => {
        const time = document.querySelector(".standalone-focus-ring > div").getBoundingClientRect();
        const options = document.querySelector(".focus-duration-options").getBoundingClientRect();
        return time.bottom > options.top + 1 && time.left < options.right && options.left < time.right;
      });
      if (collision) clipped.push({ collision: "time overlaps duration controls" });
      if (width === 260 && height === 220) await page.screenshot({ path: new URL("focus-minimum-custom-error.png", output).pathname.replace(/^\/([A-Z]:)/, "$1") });
      await page.getByRole("button", { name: "取消", exact: true }).click();
    }
    await page.getByRole("button", { name: "挂件菜单", exact: true }).click();
    const menu = await page.getByRole("menu").boundingBox();
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= width + 1 && menu.y + menu.height <= height + 1, "menu fits viewport");
    await page.keyboard.press("Escape");
    if (width === 320 || (kind === "focus" && width === 416)) await page.screenshot({ path: new URL(`${kind}-${width}x${height}.png`, output).pathname.replace(/^\/([A-Z]:)/, "$1") });
    results.push({ kind, width, height, clipped, errors });
    await page.close();
  }
  await writeFile(new URL("layout-results.json", output), JSON.stringify(results, null, 2));
  for (const result of results) assert.deepEqual({ clipped: result.clipped, errors: result.errors }, { clipped: [], errors: [] }, JSON.stringify(result));
  console.log(`挂件布局 ${results.length} 个尺寸、六行月历、自定义时长错误状态与菜单边界检查通过`);
} finally { await browser.close(); }
