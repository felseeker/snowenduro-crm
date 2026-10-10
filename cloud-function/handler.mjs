import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MetadataCredentialsProvider } from "@ydbjs/auth/metadata";
import { Driver } from "@ydbjs/core";
import { query } from "@ydbjs/query";

const root = path.dirname(fileURLToPath(import.meta.url));
const imageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);
const leadStatuses = new Set([
  "new",
  "in_progress",
  "supplier",
  "sale",
  "rejected",
]);
const availabilities = new Set(["in_stock", "on_order", "out_of_stock"]);
const categories = new Set(["snowbike", "snowmobile"]);
const imageLimit = 2 * 1024 * 1024;
const requestLimit = 3 * 1024 * 1024;
const loginAttempts = new Map();
const publicAttempts = new Map();
let sqlPromise;

export async function handleRequest(event = {}, context = {}) {
  const headers = normalizeHeaders(event.headers || {});
  const method = String(
    event.httpMethod || event.requestContext?.http?.method || "GET",
  ).toUpperCase();
  const url = requestUrl(event, headers);
  const corsHeaders = corsFor(headers.origin);

  if (method === "OPTIONS") {
    return response(204, "", {
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "600",
    });
  }

  try {
    const sql = await getSql();
    const result = await route({ event, context, headers, method, url, sql });
    if (result?.binary) {
      return {
        statusCode: result.status || 200,
        isBase64Encoded: true,
        headers: { ...securityHeaders, ...corsHeaders, ...result.headers },
        body: result.body,
      };
    }
    return response(result?.status || 200, result?.body ?? { ok: true }, {
      ...corsHeaders,
      ...(result?.headers || {}),
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.error("CRM API request failed", { path: url.pathname, status });
    return response(
      status,
      {
        error: status < 500 ? error.message : "Временная ошибка сервера CRM.",
      },
      corsHeaders,
    );
  }
}

const securityHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function response(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    isBase64Encoded: false,
    headers: { ...securityHeaders, ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(jsonSafe(body)),
  };
}

function jsonSafe(value) {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

function normalizeHeaders(source) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key.toLowerCase(),
      String(value),
    ]),
  );
}

function requestUrl(event, headers) {
  const raw = event.url || event.rawPath || event.path || "/";
  try {
    return new URL(raw, `https://${headers.host || "api.invalid"}`);
  } catch {
    return new URL("/", "https://api.invalid");
  }
}

function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsFor(origin) {
  if (!origin || !allowedOrigins().includes(origin)) return { Vary: "Origin" };
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    Vary: "Origin",
  };
}

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const connection = process.env.YDB_CONNECTION_STRING;
      if (!connection) throw new Error("Missing YDB_CONNECTION_STRING");
      const driver = new Driver(connection, {
        credentialsProvider: new MetadataCredentialsProvider(),
      });
      await driver.ready();
      const client = query(driver);
      await ensureSchema(client);
      await seedCatalog(client);
      return client;
    })().catch((error) => {
      sqlPromise = undefined;
      throw error;
    });
  }
  return sqlPromise;
}

async function ensureSchema(sql) {
  await sql`CREATE TABLE IF NOT EXISTS crm_admin (id Utf8, email Utf8, password_salt Utf8, password_hash Utf8, created_at Utf8, PRIMARY KEY (id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_sessions (token_hash Utf8, expires_at Uint64, PRIMARY KEY (token_hash))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_leads (id Utf8, public_code Uint64, created_at Utf8, customer_name Utf8, phone Utf8, product_interest Utf8, source_page Utf8, compatibility_make Utf8, compatibility_model Utf8, compatibility_year Uint64, manager_comments Utf8, status Utf8, idempotency_key Utf8, consent_at Utf8, consent_policy_version Utf8, PRIMARY KEY (id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_idempotency (idempotency_key Utf8, lead_id Utf8, public_code Uint64, PRIMARY KEY (idempotency_key))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_sequences (name Utf8, value Uint64, PRIMARY KEY (name))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_products (id Utf8, slug Utf8, category Utf8, name Utf8, data_json Utf8, availability Utf8, is_published Bool, sort_order Uint64, updated_at Utf8, PRIMARY KEY (id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_images (id Utf8, mime_type Utf8, base64_data Utf8, created_at Utf8, PRIMARY KEY (id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_telegram_recipients (id Utf8, chat_id Utf8, is_enabled Bool, PRIMARY KEY (id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_notification_outbox (lead_id Utf8, state Utf8, attempt_count Uint64, last_error Utf8, sent_at Utf8, PRIMARY KEY (lead_id))`;
  await sql`CREATE TABLE IF NOT EXISTS crm_catalog_publications (id Utf8, created_at Utf8, status Utf8, error_message Utf8, workflow_url Utf8, PRIMARY KEY (id))`;
}

async function seedCatalog(sql) {
  const existing = await queryRows(sql`SELECT id FROM crm_products LIMIT 1`);
  if (existing.length) return;
  let seed;
  try {
    seed = JSON.parse(
      await readFile(path.join(root, "catalog-seed.json"), "utf8"),
    );
  } catch {
    seed = [];
  }
  if (!Array.isArray(seed) || !seed.length) return;
  for (const [index, item] of seed.entries()) {
    const data = {
      ...item,
      gallery: Array.isArray(item.gallery) ? item.gallery : [],
    };
    await sql`UPSERT INTO crm_products (id, slug, category, name, data_json, availability, is_published, sort_order, updated_at) VALUES (${randomUUID()}, ${item.slug}, ${item.category}, ${item.name}, ${JSON.stringify(data)}, ${item.availability || "on_order"}, true, ${index}, ${new Date().toISOString()})`;
  }
}

async function route({ event, headers, method, url, sql }) {
  const pathname = decodeSafePath(url.pathname);
  if (pathname.startsWith("/uploads/") && method === "GET")
    return readImage(sql, pathname);

  if (pathname === "/api/auth/status" && method === "GET") {
    const admin = await one(
      sql`SELECT email FROM crm_admin WHERE id = ${"admin"}`,
    );
    const session = await getSession(sql, headers);
    return {
      body: {
        setupRequired: !admin,
        authenticated: Boolean(session),
        email: session ? admin?.email || null : null,
      },
    };
  }
  if (pathname === "/api/auth/setup" && method === "POST")
    return setupAdmin(sql, headers, event);
  if (pathname === "/api/auth/login" && method === "POST")
    return login(sql, headers, event);
  if (pathname === "/api/auth/logout" && method === "POST") {
    const session = await sessionToken(headers);
    if (session)
      await sql`DELETE FROM crm_sessions WHERE token_hash = ${hashToken(session)}`;
    return { body: { ok: true } };
  }
  if (pathname === "/api/public/products" && method === "GET") {
    const rows = await queryRows(
      sql`SELECT slug, category, name, data_json, availability, sort_order FROM crm_products WHERE is_published = true ORDER BY sort_order, name`,
    );
    return { body: rows.map(publicProductRow) };
  }
  if (pathname === "/api/public/leads" && method === "POST") {
    assertWebsiteOrigin(headers.origin);
    return createPublicLead(sql, headers, event);
  }
  if (pathname === "/api/catalog/sync-queue" && method === "GET") {
    assertSyncToken(headers);
    const publication = await one(
      sql`SELECT id FROM crm_catalog_publications WHERE status = ${"queued"} ORDER BY created_at LIMIT 1`,
    );
    if (!publication) return { body: { pending: false } };
    const products = await queryRows(
      sql`SELECT slug, category, name, data_json, availability, sort_order FROM crm_products WHERE is_published = true ORDER BY sort_order, name`,
    );
    return {
      body: {
        pending: true,
        publication_id: publication.id,
        products: products.map(publicProductRow),
      },
    };
  }
  if (pathname === "/api/public/catalog-publication" && method === "POST") {
    assertSyncToken(headers);
    return recordCatalogPublication(sql, event);
  }

  await requireSession(sql, headers);
  if (pathname === "/api/leads" && method === "GET") return listLeads(sql, url);
  const leadMatch = pathname.match(/^\/api\/leads\/([\w-]+)$/);
  if (leadMatch && method === "GET") {
    const lead = await one(
      sql`SELECT * FROM crm_leads WHERE id = ${leadMatch[1]}`,
    );
    if (!lead) throw httpError(404, "Заявка не найдена.");
    return { body: leadRow(lead) };
  }
  if (leadMatch && method === "PATCH")
    return updateLead(sql, leadMatch[1], event);
  if (pathname === "/api/products" && method === "GET") {
    const rows = await queryRows(
      sql`SELECT * FROM crm_products ORDER BY sort_order, name`,
    );
    return { body: rows.map(productRow) };
  }
  if (pathname === "/api/products" && method === "POST")
    return saveProduct(sql, event);
  const productMatch = pathname.match(/^\/api\/products\/([\w-]+)$/);
  if (productMatch && method === "PUT")
    return saveProduct(sql, event, productMatch[1]);
  if (productMatch && method === "DELETE") {
    const existing = await one(
      sql`SELECT id FROM crm_products WHERE id = ${productMatch[1]}`,
    );
    if (!existing) throw httpError(404, "Товар не найден.");
    await sql`DELETE FROM crm_products WHERE id = ${productMatch[1]}`;
    return { body: { ok: true } };
  }
  if (pathname === "/api/uploads" && method === "POST")
    return saveImage(sql, event);
  if (pathname === "/api/telegram/recipients" && method === "GET") {
    const rows = await queryRows(
      sql`SELECT id, chat_id, is_enabled FROM crm_telegram_recipients ORDER BY chat_id`,
    );
    return {
      body: rows.map((row) => ({
        ...row,
        is_enabled: Boolean(row.is_enabled),
      })),
    };
  }
  if (pathname === "/api/telegram/recipients" && method === "PUT")
    return saveRecipients(sql, event);
  if (pathname === "/api/telegram/status" && method === "GET") {
    const rows = await queryRows(
      sql`SELECT state, attempt_count FROM crm_notification_outbox`,
    );
    return {
      body: {
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        pending: rows.filter((row) => row.state === "pending").length,
        failed: rows.filter((row) => row.state === "failed").length,
      },
    };
  }
  if (pathname === "/api/telegram/action" && method === "POST")
    return telegramAction(sql, event);
  if (pathname === "/api/settings/status" && method === "GET") {
    const publication = await one(
      sql`SELECT id, status, created_at, error_message, workflow_url FROM crm_catalog_publications ORDER BY created_at DESC LIMIT 1`,
    );
    return {
      body: {
        email:
          (await one(sql`SELECT email FROM crm_admin WHERE id = ${"admin"}`))
            ?.email || null,
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
        githubConfigured: Boolean(process.env.SYNC_CALLBACK_TOKEN),
        siteRepository:
          process.env.GITHUB_SITE_REPOSITORY || "felseeker/snowenduro-site",
        database: "Yandex Cloud · YDB",
        lastPublication: publication || null,
      },
    };
  }
  if (pathname === "/api/catalog/publish" && method === "POST")
    return queuePublication(sql);
  throw httpError(404, "Маршрут API не найден.");
}

function decodeSafePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function parseBody(event) {
  let raw = event.body ?? "";
  if (event.isBase64Encoded && typeof raw === "string")
    raw = Buffer.from(raw, "base64").toString("utf8");
  if (typeof raw === "object" && raw !== null) return raw;
  const text = String(raw);
  if (Buffer.byteLength(text, "utf8") > requestLimit)
    throw httpError(413, "Файл слишком большой.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw httpError(400, "Некорректные данные запроса.");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function queryRows(result) {
  const resultSets = await result;
  if (Array.isArray(resultSets?.[0])) return resultSets[0];
  return Array.isArray(resultSets) ? resultSets : [];
}

async function one(result) {
  const rows = await queryRows(result);
  return rows[0] || null;
}

function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, max);
}

function normalizedPhone(value) {
  return String(value || "")
    .replace(/[^+\d]/g, "")
    .slice(0, 32);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqualText(left, right) {
  return timingSafeEqual(
    createHash("sha256").update(String(left)).digest(),
    createHash("sha256").update(String(right)).digest(),
  );
}

function bearer(headers) {
  const match = String(headers.authorization || "").match(
    /^Bearer\s+([a-f0-9]{64})$/i,
  );
  return match?.[1] || "";
}

async function sessionToken(headers) {
  return bearer(headers);
}

async function getSession(sql, headers) {
  const token = await sessionToken(headers);
  if (!token) return null;
  const row = await one(
    sql`SELECT token_hash FROM crm_sessions WHERE token_hash = ${hashToken(token)} AND expires_at > ${Date.now()}`,
  );
  return row ? { tokenHash: row.token_hash } : null;
}

async function requireSession(sql, headers) {
  if (!(await getSession(sql, headers)))
    throw httpError(401, "Сессия завершилась. Войдите снова.");
}

async function createSession(sql, email) {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 30 * 24 * 60 * 60_000;
  await sql`UPSERT INTO crm_sessions (token_hash, expires_at) VALUES (${hashToken(token)}, ${expires})`;
  await sql`DELETE FROM crm_sessions WHERE expires_at <= ${Date.now()}`;
  return { body: { authenticated: true, email, token } };
}

function requestIp(event, headers) {
  return cleanText(
    event.requestContext?.http?.sourceIp ||
      event.requestContext?.identity?.sourceIp ||
      headers["x-forwarded-for"] ||
      "unknown",
    80,
  )
    .split(",")[0]
    .trim();
}

async function setupAdmin(sql, headers, event) {
  const setupToken = process.env.SETUP_TOKEN;
  if (!setupToken)
    throw httpError(503, "Первичная настройка CRM ещё не открыта сервером.");
  const body = parseBody(event);
  if (!body.setupToken || !safeEqualText(setupToken, body.setupToken))
    throw httpError(403, "Код первичной настройки неверен.");
  const email = cleanText(body.email, 254).toLowerCase();
  const password = String(body.password || "");
  if (!/^\S+@\S+\.\S+$/.test(email))
    throw httpError(400, "Укажите рабочий email администратора.");
  if (password.length < 12 || password.length > 200)
    throw httpError(400, "Пароль должен содержать от 12 до 200 символов.");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password, salt, 64).toString("hex");
  try {
    await sql.begin(async (tx) => {
      const admin = await one(
        tx`SELECT id FROM crm_admin WHERE id = ${"admin"}`,
      );
      if (admin) throw httpError(409, "Администратор уже создан.");
      await tx`INSERT INTO crm_admin (id, email, password_salt, password_hash, created_at) VALUES (${"admin"}, ${email}, ${salt}, ${passwordHash}, ${new Date().toISOString()})`;
    });
  } catch (error) {
    if (error?.status) throw error;
    const admin = await one(
      sql`SELECT id FROM crm_admin WHERE id = ${"admin"}`,
    );
    if (admin) throw httpError(409, "Администратор уже создан.");
    throw error;
  }
  return createSession(sql, email);
}

async function login(sql, headers, event) {
  const ip = requestIp(event, headers);
  const previous = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (previous.until > Date.now() && previous.count >= 8)
    throw httpError(
      429,
      "Слишком много попыток входа. Попробуйте через 15 минут.",
    );
  const body = parseBody(event);
  const admin = await one(
    sql`SELECT email, password_salt, password_hash FROM crm_admin WHERE id = ${"admin"}`,
  );
  const salt = admin?.password_salt || "invalid-login-salt";
  const expected = admin?.password_hash || "0".repeat(128);
  const rawPassword = String(body.password || "");
  const incoming = scryptSync(
    rawPassword.length <= 200 ? rawPassword : "invalid-login-password",
    salt,
    64,
  ).toString("hex");
  const email = cleanText(body.email, 254).toLowerCase();
  if (!admin || email !== admin.email || !safeEqualText(expected, incoming)) {
    const count = previous.until > Date.now() ? previous.count + 1 : 1;
    loginAttempts.set(ip, {
      count,
      until: count >= 8 ? Date.now() + 15 * 60_000 : 0,
    });
    throw httpError(401, "Проверьте email и пароль.");
  }
  loginAttempts.delete(ip);
  return createSession(sql, admin.email);
}

function assertWebsiteOrigin(origin) {
  const websiteOrigins = (process.env.WEBSITE_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!websiteOrigins.length)
    throw httpError(503, "Приём заявок с сайта ещё не настроен.");
  if (!origin || !websiteOrigins.includes(origin))
    throw httpError(403, "Заявка отправлена с неизвестного сайта.");
}

function assertSyncToken(headers) {
  const expected = process.env.SYNC_CALLBACK_TOKEN;
  const supplied = String(headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!expected || !safeEqualText(expected, supplied))
    throw httpError(401, "Нет доступа к синхронизации каталога.");
}

function publicProductRow(row) {
  return {
    slug: row.slug,
    category: row.category,
    name: row.name,
    data: JSON.parse(row.data_json),
    availability: row.availability,
    sort_order: Number(row.sort_order || 0),
  };
}

function productRow(row) {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category,
    name: row.name,
    data: JSON.parse(row.data_json),
    availability: row.availability,
    is_published: Boolean(row.is_published),
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at,
  };
}

function leadRow(row) {
  return {
    ...row,
    public_code: Number(row.public_code),
    compatibility_year: row.compatibility_year
      ? Number(row.compatibility_year)
      : null,
  };
}

async function createPublicLead(sql, headers, event) {
  const body = parseBody(event);
  if (body.website) return { body: { ok: true } };
  const ip = requestIp(event, headers);
  const attempt = publicAttempts.get(ip) || {
    count: 0,
    reset: Date.now() + 60 * 60_000,
  };
  if (attempt.reset < Date.now()) {
    attempt.count = 0;
    attempt.reset = Date.now() + 60 * 60_000;
  }
  if (++attempt.count > 8)
    throw httpError(429, "Слишком много заявок. Попробуйте позже.");
  publicAttempts.set(ip, attempt);

  const name = cleanText(body.customer_name, 100);
  const phone = normalizedPhone(body.phone);
  const interest = cleanText(body.product_interest, 200);
  const source = cleanText(body.source_page || "snowenduro.ru", 600);
  const idempotency = cleanText(body.idempotency_key, 80);
  const year =
    body.compatibility_year == null || body.compatibility_year === ""
      ? 0
      : Number(body.compatibility_year);
  if (year && (!Number.isInteger(year) || year < 1950 || year > 2100))
    throw httpError(400, "Проверьте год выпуска техники.");
  if (
    name.length < 2 ||
    phone.replace(/\D/g, "").length < 7 ||
    interest.length < 2
  )
    throw httpError(400, "Заполните имя, телефон и интересующий товар.");
  if (!body.consent || !/^[a-f0-9-]{36}$/i.test(idempotency))
    throw httpError(400, "Нужно подтвердить согласие на обработку данных.");

  let saved;
  try {
    saved = await sql.begin({ idempotent: true }, async (tx) => {
      const duplicate = await one(
        tx`SELECT public_code FROM crm_idempotency WHERE idempotency_key = ${idempotency}`,
      );
      if (duplicate)
        return { code: Number(duplicate.public_code), duplicate: true };
      const sequence = await one(
        tx`SELECT value FROM crm_sequences WHERE name = ${"lead_code"}`,
      );
      const code = Number(sequence?.value || 0) + 1;
      const id = randomUUID();
      const now = new Date().toISOString();
      await tx`UPSERT INTO crm_sequences (name, value) VALUES (${"lead_code"}, ${code})`;
      await tx`INSERT INTO crm_leads (id, public_code, created_at, customer_name, phone, product_interest, source_page, compatibility_make, compatibility_model, compatibility_year, manager_comments, status, idempotency_key, consent_at, consent_policy_version) VALUES (${id}, ${code}, ${now}, ${name}, ${phone}, ${interest}, ${source}, ${cleanText(body.compatibility_make, 100)}, ${cleanText(body.compatibility_model, 100)}, ${year}, ${""}, ${"new"}, ${idempotency}, ${now}, ${cleanText(body.consent_policy_version || "v1", 80)})`;
      await tx`INSERT INTO crm_idempotency (idempotency_key, lead_id, public_code) VALUES (${idempotency}, ${id}, ${code})`;
      await tx`UPSERT INTO crm_notification_outbox (lead_id, state, attempt_count, last_error, sent_at) VALUES (${id}, ${"pending"}, ${0}, ${""}, ${""})`;
      return { id, code, duplicate: false };
    });
  } catch (error) {
    const duplicate = await one(
      sql`SELECT public_code FROM crm_idempotency WHERE idempotency_key = ${idempotency}`,
    );
    if (duplicate)
      return { body: { ok: true, code: Number(duplicate.public_code) } };
    throw error;
  }
  if (!saved.duplicate) await dispatchNotification(sql, saved.id);
  return {
    status: saved.duplicate ? 200 : 201,
    body: { ok: true, code: saved.code },
  };
}

async function dispatchNotification(sql, leadId) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const recipients = await queryRows(
    sql`SELECT chat_id FROM crm_telegram_recipients WHERE is_enabled = true`,
  );
  if (!token || !recipients.length) {
    await sql`UPSERT INTO crm_notification_outbox (lead_id, state, attempt_count, last_error, sent_at) VALUES (${leadId}, ${"pending"}, ${0}, ${token ? "Нет активных получателей." : "Токен бота не настроен."}, ${""})`;
    return;
  }
  const lead = await one(
    sql`SELECT public_code, product_interest FROM crm_leads WHERE id = ${leadId}`,
  );
  if (!lead) return;
  const old = await one(
    sql`SELECT attempt_count FROM crm_notification_outbox WHERE lead_id = ${leadId}`,
  );
  const attemptCount = Number(old?.attempt_count || 0) + 1;
  await sql`UPSERT INTO crm_notification_outbox (lead_id, state, attempt_count, last_error, sent_at) VALUES (${leadId}, ${"running"}, ${attemptCount}, ${""}, ${""})`;
  try {
    const safeInterest = await telegramSafeInterest(sql, lead.product_interest);
    for (const { chat_id } of recipients) {
      await telegramCall(token, "sendMessage", {
        chat_id,
        text: `Новая заявка #${String(lead.public_code).padStart(4, "0")}\nИнтерес: ${safeInterest}`,
      });
    }
    await sql`UPSERT INTO crm_notification_outbox (lead_id, state, attempt_count, last_error, sent_at) VALUES (${leadId}, ${"sent"}, ${attemptCount}, ${""}, ${new Date().toISOString()})`;
  } catch {
    await sql`UPSERT INTO crm_notification_outbox (lead_id, state, attempt_count, last_error, sent_at) VALUES (${leadId}, ${"failed"}, ${attemptCount}, ${"Не удалось отправить Telegram-уведомление."}, ${""})`;
  }
}

async function telegramSafeInterest(sql, value) {
  const interest = cleanText(value, 200);
  const products = await queryRows(
    sql`SELECT name, slug FROM crm_products WHERE is_published = true`,
  );
  const match = products.find(
    (product) =>
      product.name.toLowerCase() === interest.toLowerCase() ||
      product.slug.toLowerCase() === interest.toLowerCase(),
  );
  if (match) return cleanText(match.name, 120);
  if (/совместим/i.test(interest)) return "Проверка совместимости Snowbike";
  if (/snowbike|сноубайк/i.test(interest)) return "Snowbike-комплект";
  if (/снегоход|snowmobile/i.test(interest)) return "Снегоход под заказ";
  return "Обращение с сайта";
}

async function listLeads(sql, url) {
  const all = await queryRows(
    sql`SELECT * FROM crm_leads ORDER BY created_at DESC LIMIT 1000`,
  );
  const term = cleanText(url.searchParams.get("q"), 100).toLocaleLowerCase(
    "ru-RU",
  );
  const status = url.searchParams.get("status");
  const filtered = all.filter((row) => {
    if (
      status &&
      status !== "all" &&
      leadStatuses.has(status) &&
      row.status !== status
    )
      return false;
    if (!term) return true;
    return [row.customer_name, row.phone, row.product_interest].some((value) =>
      String(value || "")
        .toLocaleLowerCase("ru-RU")
        .includes(term),
    );
  });
  return { body: filtered.map(leadRow) };
}

async function updateLead(sql, id, event) {
  const existing = await one(sql`SELECT * FROM crm_leads WHERE id = ${id}`);
  if (!existing) throw httpError(404, "Заявка не найдена.");
  const body = parseBody(event);
  const status =
    body.status === undefined ? existing.status : String(body.status);
  if (!leadStatuses.has(status))
    throw httpError(400, "Неизвестный статус заявки.");
  const comments =
    body.manager_comments === undefined
      ? existing.manager_comments
      : cleanText(body.manager_comments, 5000);
  await sql`UPSERT INTO crm_leads (id, public_code, created_at, customer_name, phone, product_interest, source_page, compatibility_make, compatibility_model, compatibility_year, manager_comments, status, idempotency_key, consent_at, consent_policy_version) VALUES (${existing.id}, ${Number(existing.public_code)}, ${existing.created_at}, ${existing.customer_name}, ${existing.phone}, ${existing.product_interest}, ${existing.source_page}, ${existing.compatibility_make}, ${existing.compatibility_model}, ${Number(existing.compatibility_year || 0)}, ${comments}, ${status}, ${existing.idempotency_key}, ${existing.consent_at}, ${existing.consent_policy_version})`;
  const updated = await one(sql`SELECT * FROM crm_leads WHERE id = ${id}`);
  return { body: leadRow(updated) };
}

async function saveProduct(sql, event, id = "") {
  const body = parseBody(event);
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw httpError(400, "Карточка товара заполнена некорректно.");
  const slug = cleanText(body.slug, 120).toLowerCase();
  const name = cleanText(body.name || data.name, 160);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !name ||
    !categories.has(body.category)
  )
    throw httpError(400, "Проверьте название, адрес и категорию товара.");
  if (!Array.isArray(data.gallery)) data.gallery = [];
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > 1_000_000)
    throw httpError(413, "Карточка товара слишком большая.");
  const existingRows = await queryRows(sql`SELECT id, slug FROM crm_products`);
  if (existingRows.some((row) => row.slug === slug && row.id !== id))
    throw httpError(409, "Адрес товара уже занят.");
  if (id && !existingRows.some((row) => row.id === id))
    throw httpError(404, "Товар не найден.");
  const now = new Date().toISOString();
  const productId = id || randomUUID();
  const availability = availabilities.has(body.availability)
    ? body.availability
    : "on_order";
  const published = Boolean(body.is_published);
  const sortOrder = Math.max(0, Math.floor(Number(body.sort_order) || 0));
  await sql`UPSERT INTO crm_products (id, slug, category, name, data_json, availability, is_published, sort_order, updated_at) VALUES (${productId}, ${slug}, ${body.category}, ${name}, ${serialized}, ${availability}, ${published}, ${sortOrder}, ${now})`;
  const row = await one(
    sql`SELECT * FROM crm_products WHERE id = ${productId}`,
  );
  return { status: id ? 200 : 201, body: productRow(row) };
}

async function saveImage(sql, event) {
  const body = parseBody(event);
  const mime = String(body.mimeType || "").toLowerCase();
  if (!imageTypes.has(mime))
    throw httpError(400, "Поддерживаются JPG, PNG, WebP и AVIF.");
  const encoded = String(body.base64 || "").replace(/\s/g, "");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > imageLimit)
    throw httpError(413, "Фото должно быть не больше 2 МБ.");
  if (bytes.toString("base64") !== encoded)
    throw httpError(400, "Файл изображения повреждён.");
  const ext = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  }[mime];
  const id = `${randomBytes(16).toString("hex")}.${ext}`;
  await sql`INSERT INTO crm_images (id, mime_type, base64_data, created_at) VALUES (${id}, ${mime}, ${bytes.toString("base64")}, ${new Date().toISOString()})`;
  return { status: 201, body: { src: `/uploads/${id}` } };
}

async function readImage(sql, pathname) {
  const match = pathname.match(
    /^\/uploads\/([a-f0-9]{32}\.(jpg|png|webp|avif))$/i,
  );
  if (!match) throw httpError(404, "Файл не найден.");
  const image = await one(
    sql`SELECT mime_type, base64_data FROM crm_images WHERE id = ${match[1]}`,
  );
  if (!image) throw httpError(404, "Файл не найден.");
  return {
    status: 200,
    binary: true,
    body: image.base64_data,
    headers: {
      "Content-Type": image.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

async function saveRecipients(sql, event) {
  const body = parseBody(event);
  const ids = [
    ...new Set(
      (Array.isArray(body.chatIds) ? body.chatIds : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  if (ids.some((id) => !/^-?\d{1,20}$/.test(id)))
    throw httpError(
      400,
      "Chat ID должен содержать только цифры; для групп допустим знак минус.",
    );
  const old = await queryRows(sql`SELECT id FROM crm_telegram_recipients`);
  for (const row of old)
    if (!ids.includes(row.id))
      await sql`DELETE FROM crm_telegram_recipients WHERE id = ${row.id}`;
  for (const chatId of ids)
    await sql`UPSERT INTO crm_telegram_recipients (id, chat_id, is_enabled) VALUES (${chatId}, ${chatId}, true)`;
  const rows = await queryRows(
    sql`SELECT id, chat_id, is_enabled FROM crm_telegram_recipients ORDER BY chat_id`,
  );
  return {
    body: rows.map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) })),
  };
}

async function telegramAction(sql, event) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    throw httpError(503, "Токен Telegram-бота ещё не настроен на сервере.");
  const body = parseBody(event);
  if (body.action === "discover") {
    const result = await telegramCall(token, "getUpdates", {
      limit: 100,
      allowed_updates: ["message"],
    });
    const chats = new Map();
    for (const update of result.result || []) {
      const chat = update.message?.chat;
      if (chat && ["private", "group", "supergroup"].includes(chat.type))
        chats.set(String(chat.id), {
          chatId: String(chat.id),
          type: chat.type,
        });
    }
    return { body: { chats: [...chats.values()] } };
  }
  if (body.action === "retry") {
    const pending = await queryRows(
      sql`SELECT lead_id FROM crm_notification_outbox WHERE state IN (${"pending"}, ${"failed"}) LIMIT 100`,
    );
    let sent = 0;
    for (const item of pending) {
      await dispatchNotification(sql, item.lead_id);
      const state = await one(
        sql`SELECT state FROM crm_notification_outbox WHERE lead_id = ${item.lead_id}`,
      );
      if (state?.state === "sent") sent += 1;
    }
    return { body: { sent, checked: pending.length } };
  }
  const recipients = await queryRows(
    sql`SELECT chat_id FROM crm_telegram_recipients WHERE is_enabled = true`,
  );
  if (!recipients.length)
    throw httpError(400, "Сначала добавьте Chat ID получателей.");
  if (body.action === "test") {
    for (const { chat_id } of recipients)
      await telegramCall(token, "sendMessage", {
        chat_id,
        text: "Тестовое уведомление SnowEnduro CRM. Персональные данные клиентов не отправляются.",
      });
    return { body: { sent: recipients.length } };
  }
  throw httpError(400, "Неизвестное действие Telegram.");
}

async function telegramCall(token, method, body) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    },
  );
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw httpError(502, "Telegram не ответил на запрос.");
  return data;
}

async function queuePublication(sql) {
  const id = randomUUID();
  await sql`INSERT INTO crm_catalog_publications (id, created_at, status, error_message, workflow_url) VALUES (${id}, ${new Date().toISOString()}, ${"queued"}, ${""}, ${""})`;
  return {
    status: 202,
    body: { ok: true, publication_id: id, status: "queued" },
  };
}

async function recordCatalogPublication(sql, event) {
  const body = parseBody(event);
  const id = cleanText(body.publication_id, 80);
  if (
    !/^[a-f0-9-]{36}$/i.test(id) ||
    !["succeeded", "failed"].includes(body.status)
  )
    throw httpError(400, "Некорректный статус публикации.");
  const errorMessage =
    body.status === "failed"
      ? cleanText(
          body.error_message ||
            "Сборка или публикация сайта завершилась ошибкой.",
          500,
        )
      : "";
  const workflowUrl = cleanText(body.workflow_url, 500);
  const existing = await one(
    sql`SELECT id FROM crm_catalog_publications WHERE id = ${id}`,
  );
  if (!existing) throw httpError(404, "Публикация каталога не найдена.");
  await sql`UPDATE crm_catalog_publications SET status = ${body.status}, error_message = ${errorMessage}, workflow_url = ${workflowUrl} WHERE id = ${id}`;
  return { body: { ok: true } };
}
