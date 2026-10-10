import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = mkdtempSync(path.join(os.tmpdir(), "snowenduro-crm-smoke-"));
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  HOST: "127.0.0.1",
  PORT: String(port),
  CRM_DATA_DIR: dataDir,
  WEBSITE_ORIGIN: "https://snowenduro.ru",
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "",
  GITHUB_TOKEN: "",
  SYNC_CALLBACK_TOKEN: "",
  SETUP_TOKEN: "",
};
const server = spawn(process.execPath, ["server/index.mjs", "--dev"], {
  cwd: root,
  env,
  stdio: "ignore",
  windowsHide: true,
});
const checks = [];
let browser;

try {
  await waitForServer();
  const anonymousLeads = await request("/api/leads");
  assert.equal(anonymousLeads.response.status, 401);
  checks.push("заявки закрыты без входа");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/#/setup`, {
    waitUntil: "domcontentloaded",
    timeout: 10_000,
  });
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill("smoke@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("A-strong-test-password-2026");
  await page
    .getByLabel("Повторите пароль", { exact: true })
    .fill("A-strong-test-password-2026");
  await page.getByRole("button", { name: "Создать CRM" }).click();
  await page
    .getByRole("heading", { name: "Заявки" })
    .waitFor({ state: "visible" });
  const sessionToken = await page.evaluate(() =>
    sessionStorage.getItem("snowenduro.crm.session"),
  );
  assert.match(sessionToken ?? "", /^[a-f0-9]{64}$/);
  const authorization = `Bearer ${sessionToken}`;
  checks.push("администратор и защищённая сессия создаются через интерфейс");

  const idempotencyKey = crypto.randomUUID();
  const leadBody = {
    customer_name: "CRM Smoke Customer",
    phone: "+70000000000",
    product_interest: "Snowbike-комплект",
    source_page: "https://snowenduro.ru/catalog",
    compatibility_make: "KTM",
    compatibility_model: "EXC",
    compatibility_year: 2024,
    consent: true,
    consent_policy_version: "test-v1",
    idempotency_key: idempotencyKey,
  };
  const leadResponse = await request("/api/public/leads", {
    method: "POST",
    origin: "https://snowenduro.ru",
    body: leadBody,
  });
  assert.equal(leadResponse.response.status, 201);
  const duplicateLead = await request("/api/public/leads", {
    method: "POST",
    origin: "https://snowenduro.ru",
    body: leadBody,
  });
  assert.equal(duplicateLead.response.status, 200);
  assert.equal(duplicateLead.data.code, leadResponse.data.code);
  const rejectedOrigin = await request("/api/public/leads", {
    method: "POST",
    origin: "https://example.invalid",
    body: leadBody,
  });
  assert.equal(rejectedOrigin.response.status, 403);
  await page
    .getByRole("table")
    .getByText("CRM Smoke Customer", { exact: true })
    .waitFor({ state: "visible" });
  await page.getByLabel("Изменить статус").first().selectOption("in_progress");
  await page.getByLabel("Открыть заявку").first().click();
  await page
    .getByRole("heading", { name: "CRM Smoke Customer" })
    .waitFor({ state: "visible" });
  await page.getByLabel("Комментарий менеджера").fill("Smoke test comment");
  await page.getByRole("button", { name: /Сохранить комментарий/ }).click();
  await page
    .getByText("Сохранено", { exact: true })
    .waitFor({ state: "visible" });
  checks.push("заявка сохраняется без дублей, статус и комментарий меняются");

  await page.getByRole("link", { name: "Каталог" }).click();
  await page
    .getByRole("heading", { name: "Каталог" })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Новый товар" }).click();
  await page
    .locator("#product-editor input")
    .first()
    .fill("CRM UI Smoke Product");
  await page
    .locator("#product-editor textarea")
    .first()
    .fill("Smoke test description");
  await page
    .getByRole("checkbox", { name: "Показывать на сайте после синхронизации" })
    .check();
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/WQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pixel,
  });
  await page.getByRole("button", { name: "Сохранить товар" }).click();
  await page
    .getByText("Изменения сохранены в CRM.", { exact: false })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  await page
    .getByRole("heading", { name: "CRM UI Smoke Product" })
    .waitFor({ state: "visible" });
  const productCard = page
    .locator("article")
    .filter({ hasText: "CRM UI Smoke Product" });
  await productCard.getByRole("button", { name: "Изменить" }).click();
  await page
    .locator("#product-editor textarea")
    .first()
    .fill("Updated smoke test description");
  await page.getByRole("button", { name: "Сохранить товар" }).click();
  await page
    .getByText("Изменения сохранены в CRM.", { exact: false })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Закрыть редактор" }).click();
  const catalog = await request("/api/public/products");
  assert.equal(catalog.response.status, 200);
  assert.ok(
    catalog.data.some(
      (product) =>
        product.slug === "crm-ui-smoke-product" &&
        product.data.summary === "Updated smoke test description",
    ),
  );
  checks.push(
    "товар и фото редактируются через интерфейс и попадают в публичный каталог",
  );

  await page.getByRole("link", { name: "Telegram" }).click();
  await page
    .getByRole("heading", { name: "Telegram" })
    .waitFor({ state: "visible" });
  await page
    .getByText("токен не настроен", { exact: false })
    .waitFor({ state: "visible" });
  await page.getByRole("link", { name: "Настройки" }).click();
  await page
    .getByRole("heading", { name: "Настройки" })
    .waitFor({ state: "visible" });
  await page
    .getByText("Нужны серверные ключи GitHub и callback", { exact: true })
    .waitFor({ state: "visible" });
  const telegramStatus = await request("/api/telegram/status", {
    authorization,
  });
  assert.equal(telegramStatus.data.configured, false);
  const telegramAction = await request("/api/telegram/action", {
    method: "POST",
    authorization,
    body: { action: "test" },
  });
  assert.equal(telegramAction.response.status, 503);
  const publishAction = await request("/api/catalog/publish", {
    method: "POST",
    authorization,
    body: {},
  });
  assert.equal(publishAction.response.status, 503);
  checks.push(
    "без ключей интеграции не отправляют данные и сообщают, что настроить",
  );

  await page.getByRole("button", { name: "Выйти" }).click();
  await page
    .getByRole("heading", { name: "Вход в CRM" })
    .waitFor({ state: "visible" });
  await page
    .getByLabel("Электронная почта", { exact: true })
    .fill("smoke@example.test");
  await page
    .getByLabel("Пароль", { exact: true })
    .fill("A-strong-test-password-2026");
  await page.getByRole("button", { name: "Войти" }).click();
  await page
    .getByRole("heading", { name: "Заявки" })
    .waitFor({ state: "visible" });
  assert.deepEqual(pageErrors, []);
  checks.push("выход и повторный вход работают без ошибок браузера");

  process.stdout.write(
    JSON.stringify({ passed: checks.length, checks }, null, 2) + "\n",
  );
} finally {
  if (browser) await browser.close();
  server.kill();
  await delay(500);
  rmSync(dataDir, { recursive: true, force: true });
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const { port: selectedPort } = address;
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return selectedPort;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/auth/status`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("CRM smoke-test server did not start.");
}

async function request(
  route,
  { method = "GET", body, authorization, origin = baseUrl } = {},
) {
  const headers = { Origin: origin };
  if (authorization) headers.Authorization = authorization;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { response, data };
}
