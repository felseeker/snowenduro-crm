import { createServer } from "node:http";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.resolve(
  process.env.CRM_DATA_DIR || path.join(root, "data"),
);
const uploadDir = path.join(dataDir, "uploads");
const dbPath = path.join(dataDir, "crm.sqlite");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const isDev = process.argv.includes("--dev");
const maxJsonBytes = 20 * 1024 * 1024;
const allowedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

await mkdir(uploadDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`
  pragma journal_mode = WAL;
  pragma foreign_keys = ON;
  create table if not exists admin (
    id integer primary key check (id = 1),
    email text not null,
    password_salt text not null,
    password_hash text not null,
    created_at text not null
  );
  create table if not exists sessions (
    token_hash text primary key,
    expires_at integer not null
  );
  create table if not exists leads (
    id text primary key,
    public_code integer not null unique,
    created_at text not null,
    customer_name text not null,
    phone text not null,
    product_interest text not null,
    source_page text not null,
    compatibility_make text,
    compatibility_model text,
    compatibility_year integer,
    manager_comments text not null default '',
    status text not null default 'new',
    idempotency_key text not null unique,
    consent_at text not null,
    consent_policy_version text not null
  );
  create index if not exists leads_created_idx on leads(created_at desc);
  create table if not exists products (
    id text primary key,
    slug text not null unique,
    category text not null,
    name text not null,
    data_json text not null,
    availability text not null default 'on_order',
    is_published integer not null default 0,
    sort_order integer not null default 0,
    updated_at text not null
  );
  create table if not exists telegram_recipients (
    id text primary key,
    chat_id text not null unique,
    is_enabled integer not null default 1
  );
  create table if not exists notification_outbox (
    id text primary key,
    lead_id text not null unique references leads(id) on delete cascade,
    state text not null default 'pending',
    attempt_count integer not null default 0,
    last_error text,
    sent_at text
  );
  create table if not exists catalog_publications (
    id text primary key,
    created_at text not null,
    status text not null,
    error_message text,
    workflow_url text
  );
`);
db.prepare(
  "update notification_outbox set state = 'pending' where state = 'running'",
).run();

const productCount = db
  .prepare("select count(*) as count from products")
  .get().count;
if (productCount === 0) {
  try {
    const seed = JSON.parse(
      await readFile(path.join(root, "server/catalog-seed.json"), "utf8"),
    );
    const insert = db.prepare(`
      insert or ignore into products
      (id, slug, category, name, data_json, availability, is_published, sort_order, updated_at)
      values (?, ?, ?, ?, ?, 'on_order', 1, ?, ?)
    `);
    const now = new Date().toISOString();
    db.exec("begin");
    for (const [index, item] of seed.entries()) {
      insert.run(
        randomUUID(),
        item.slug,
        item.category,
        item.name,
        JSON.stringify({ ...item, gallery: item.gallery || [] }),
        index,
        now,
      );
    }
    db.exec("commit");
  } catch (error) {
    try {
      db.exec("rollback");
    } catch (rollbackError) {
      console.warn("Initial catalog rollback failed:", rollbackError);
    }
    console.warn("Initial catalog seed was not loaded:", error.message);
  }
}

const loginFailures = new Map();
const publicAttempts = new Map();
let vite;
let viteMiddleware;
if (isDev) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({
    configFile: path.join(root, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server: undefined }, host },
    appType: "spa",
  });
  viteMiddleware = vite.middlewares;
}

const server = createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/uploads/")) {
      await serveUpload(req, res, url.pathname.slice("/uploads/".length));
      return;
    }
    if (isDev) {
      viteMiddleware(req, res, (error) => {
        if (error) sendJson(res, 500, { error: "Ошибка сервера разработки." });
      });
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error("Request failed:", error);
    if (!res.headersSent)
      sendJson(res, error.status || 500, {
        error: error.publicMessage || "Внутренняя ошибка сервера.",
      });
    else res.destroy();
  }
});

server.listen(port, host, () => {
  process.stdout.write(`SnowEnduro CRM is running at http://${host}:${port}\n`);
  process.stdout.write(`Database: ${dbPath}\n`);
  if (isDev) process.stdout.write("Development mode enabled\n");
});

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    if (url.pathname === "/api/public/leads") {
      allowWebsiteOrigin(req, res);
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
    } else {
      res.writeHead(204);
    }
    res.end();
    return;
  }
  if (url.pathname === "/api/auth/status" && req.method === "GET") {
    const admin = getAdmin();
    const session = getSession(req);
    return sendJson(res, 200, {
      setupRequired: !admin,
      authenticated: Boolean(session),
      email: session ? admin.email : null,
    });
  }
  if (url.pathname === "/api/auth/setup" && req.method === "POST") {
    assertSameOrigin(req);
    if (getAdmin()) throw httpError(409, "Администратор уже создан.");
    if (process.env.NODE_ENV === "production" && !process.env.SETUP_TOKEN) {
      throw httpError(
        503,
        "Задайте SETUP_TOKEN на сервере перед первичной настройкой.",
      );
    }
    const body = await readJson(req);
    if (process.env.SETUP_TOKEN && body.setupToken !== process.env.SETUP_TOKEN)
      throw httpError(403, "Код первичной настройки неверен.");
    const email = cleanText(body.email, 254).toLowerCase();
    const password = String(body.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw httpError(400, "Укажите рабочий email администратора.");
    if (password.length < 12 || password.length > 200)
      throw httpError(400, "Пароль должен содержать от 12 до 200 символов.");
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    db.prepare(
      "insert into admin (id, email, password_salt, password_hash, created_at) values (1, ?, ?, ?, ?)",
    ).run(email, salt, hash, new Date().toISOString());
    return createSession(req, res, email);
  }
  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    assertSameOrigin(req);
    const ip = requestIp(req);
    const attempts = loginFailures.get(ip) || { count: 0, until: 0 };
    if (attempts.until > Date.now() && attempts.count >= 8)
      throw httpError(
        429,
        "Слишком много попыток входа. Попробуйте через 15 минут.",
      );
    const body = await readJson(req);
    const admin = getAdmin();
    const salt = admin?.password_salt || "invalid-login-salt";
    const expected = admin?.password_hash || "0".repeat(128);
    const incoming = scryptSync(String(body.password || ""), salt, 64).toString(
      "hex",
    );
    const matches = safeEqual(expected, incoming);
    if (
      !admin ||
      cleanText(body.email, 254).toLowerCase() !== admin.email ||
      !matches
    ) {
      const count = attempts.until > Date.now() ? attempts.count + 1 : 1;
      loginFailures.set(ip, {
        count,
        until: count >= 8 ? Date.now() + 15 * 60_000 : 0,
      });
      throw httpError(401, "Проверьте email и пароль.");
    }
    loginFailures.delete(ip);
    return createSession(req, res, admin.email);
  }
  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    assertSameOrigin(req);
    const token = getCookie(req, "snowenduro_session");
    if (token)
      db.prepare("delete from sessions where token_hash = ?").run(
        hashToken(token),
      );
    res.setHeader("Set-Cookie", clearSessionCookie(req));
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === "/api/public/products" && req.method === "GET") {
    const rows = db
      .prepare(
        "select slug, category, name, data_json as data, availability, sort_order from products where is_published = 1 order by sort_order, name",
      )
      .all();
    return sendJson(
      res,
      200,
      rows.map((row) => ({ ...row, data: JSON.parse(row.data) })),
    );
  }
  if (url.pathname === "/api/public/leads" && req.method === "POST") {
    allowWebsiteOrigin(req, res);
    return addPublicLead(req, res);
  }
  if (
    url.pathname === "/api/public/catalog-publication" &&
    req.method === "POST"
  )
    return recordCatalogPublication(req, res);

  requireSession(req);
  if (!isSafeMutation(req))
    throw httpError(403, "Запрос отклонён: источник запроса не подтверждён.");
  if (url.pathname === "/api/leads" && req.method === "GET")
    return listLeads(req, res, url);
  const leadMatch = url.pathname.match(/^\/api\/leads\/([\w-]+)$/);
  if (leadMatch && req.method === "GET") {
    const lead = db
      .prepare("select * from leads where id = ?")
      .get(leadMatch[1]);
    if (!lead) throw httpError(404, "Заявка не найдена.");
    return sendJson(res, 200, lead);
  }
  if (leadMatch && req.method === "PATCH")
    return updateLead(req, res, leadMatch[1]);
  if (url.pathname === "/api/products" && req.method === "GET") {
    const rows = db
      .prepare("select * from products order by sort_order, name")
      .all();
    return sendJson(res, 200, rows.map(productRow));
  }
  if (url.pathname === "/api/products" && req.method === "POST")
    return saveProduct(req, res);
  const productMatch = url.pathname.match(/^\/api\/products\/([\w-]+)$/);
  if (productMatch && req.method === "PUT")
    return saveProduct(req, res, productMatch[1]);
  if (productMatch && req.method === "DELETE") {
    const result = db
      .prepare("delete from products where id = ?")
      .run(productMatch[1]);
    if (!result.changes) throw httpError(404, "Товар не найден.");
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === "/api/uploads" && req.method === "POST")
    return uploadImage(req, res);
  if (url.pathname === "/api/telegram/recipients" && req.method === "GET") {
    const rows = db
      .prepare(
        "select id, chat_id, is_enabled from telegram_recipients order by chat_id",
      )
      .all();
    return sendJson(
      res,
      200,
      rows.map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) })),
    );
  }
  if (url.pathname === "/api/telegram/recipients" && req.method === "PUT")
    return saveRecipients(req, res);
  if (url.pathname === "/api/telegram/status" && req.method === "GET") {
    const counts = db
      .prepare(
        "select state, count(*) as count from notification_outbox group by state",
      )
      .all();
    return sendJson(res, 200, {
      configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      pending: Number(
        counts.find((row) => row.state === "pending")?.count || 0,
      ),
      failed: Number(counts.find((row) => row.state === "failed")?.count || 0),
    });
  }
  if (url.pathname === "/api/telegram/action" && req.method === "POST")
    return telegramAction(req, res);
  if (url.pathname === "/api/settings/status" && req.method === "GET") {
    const lastPublication =
      db
        .prepare(
          "select id, status, created_at, error_message, workflow_url from catalog_publications order by rowid desc limit 1",
        )
        .get() || null;
    return sendJson(res, 200, {
      email: getAdmin()?.email,
      telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      githubConfigured: Boolean(
        process.env.GITHUB_TOKEN && process.env.SYNC_CALLBACK_TOKEN,
      ),
      siteRepository:
        process.env.GITHUB_SITE_REPOSITORY || "felseeker/snowenduro-site",
      database: "SQLite · локальный файл",
      lastPublication,
    });
  }
  if (url.pathname === "/api/catalog/publish" && req.method === "POST")
    return dispatchCatalogPublication(res);
  throw httpError(404, "Маршрут API не найден.");
}

function getAdmin() {
  return db.prepare("select * from admin where id = 1").get();
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
function safeEqual(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}
function safeTextEqual(a, b) {
  const left = createHash("sha256").update(String(a)).digest();
  const right = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(left, right);
}
function getCookie(req, name) {
  return (
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
function getSession(req) {
  const token = getCookie(req, "snowenduro_session");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = db
    .prepare(
      "select token_hash from sessions where token_hash = ? and expires_at > ?",
    )
    .get(hashToken(token), Date.now());
  return session ? { tokenHash: session.token_hash } : null;
}
function requireSession(req) {
  if (!getSession(req))
    throw httpError(401, "Сессия завершилась. Войдите снова.");
}
function createSession(req, res, email) {
  const token = randomBytes(32).toString("hex");
  const expires = Date.now() + 30 * 24 * 60 * 60_000;
  db.prepare("insert into sessions (token_hash, expires_at) values (?, ?)").run(
    hashToken(token),
    expires,
  );
  db.prepare("delete from sessions where expires_at <= ?").run(Date.now());
  const secure =
    process.env.NODE_ENV === "production" ||
    req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `snowenduro_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secure ? "; Secure" : ""}`,
  );
  return sendJson(res, 200, { authenticated: true, email });
}
function clearSessionCookie(req) {
  const secure =
    process.env.NODE_ENV === "production" ||
    req.headers["x-forwarded-proto"] === "https";
  return `snowenduro_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin)
    throw httpError(403, "Запрос без подтверждённого источника отклонён.");
  const hostHeader = req.headers.host || "";
  const expected = `${req.headers["x-forwarded-proto"] === "https" ? "https" : "http"}://${hostHeader}`;
  if (origin !== expected)
    throw httpError(403, "Запрос отправлен с другого сайта.");
}
function isSafeMutation(req) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method || ""))
    return true;
  try {
    assertSameOrigin(req);
    return true;
  } catch {
    return false;
  }
}
function allowWebsiteOrigin(req, res) {
  const allowed = (process.env.WEBSITE_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (!allowed.length)
    throw httpError(503, "Приём заявок с сайта ещё не настроен.");
  if (!origin || !allowed.includes(origin))
    throw httpError(403, "Заявка отправлена с неизвестного сайта.");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
}
function requestIp(req) {
  const forwarded =
    process.env.TRUST_PROXY === "1" ? req.headers["x-forwarded-for"] : "";
  return String(forwarded || req.socket.remoteAddress || "local")
    .split(",")[0]
    .trim();
}
function cleanText(value, max) {
  return String(value ?? "")
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, max);
}
function httpError(status, publicMessage) {
  const error = new Error(publicMessage);
  error.status = status;
  error.publicMessage = publicMessage;
  return error;
}
function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxJsonBytes) throw httpError(413, "Файл слишком большой.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "Некорректные данные запроса.");
  }
}
function normalizedPhone(value) {
  return String(value || "")
    .replace(/[^+\d]/g, "")
    .slice(0, 32);
}
function validStatus(value) {
  return ["new", "in_progress", "supplier", "sale", "rejected"].includes(value);
}
async function dispatchCatalogPublication(res) {
  const token = process.env.GITHUB_TOKEN;
  const callbackToken = process.env.SYNC_CALLBACK_TOKEN;
  const repository = cleanText(
    process.env.GITHUB_SITE_REPOSITORY || "felseeker/snowenduro-site",
    120,
  );
  if (!token || !callbackToken)
    throw httpError(
      503,
      "Синхронизация каталога пока не подключена на сервере.",
    );
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw httpError(503, "Проверьте настройки репозитория сайта на сервере.");
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    "insert into catalog_publications (id, created_at, status) values (?, ?, 'queued')",
  ).run(id, createdAt);
  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: "snowenduro_catalog_publish",
          client_payload: { publication_id: id },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 204)
      throw new Error(`GitHub returned ${response.status}`);
    return sendJson(res, 202, {
      ok: true,
      publication_id: id,
      status: "queued",
    });
  } catch (error) {
    console.warn("Catalog publication dispatch failed:", error.message);
    db.prepare(
      "update catalog_publications set status = 'failed', error_message = ? where id = ?",
    ).run(
      "Не удалось запустить публикацию на GitHub. Проверьте токен и права доступа.",
      id,
    );
    throw httpError(
      502,
      "Не удалось запустить публикацию каталога. Проверьте подключение GitHub в настройках сервера.",
    );
  }
}
async function recordCatalogPublication(req, res) {
  const expected = process.env.SYNC_CALLBACK_TOKEN;
  const supplied = String(req.headers.authorization || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!expected || !safeTextEqual(expected, supplied))
    throw httpError(401, "Нет доступа к обновлению статуса публикации.");
  const body = await readJson(req);
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
      : null;
  const workflowUrl = cleanText(body.workflow_url, 500);
  const result = db
    .prepare(
      "update catalog_publications set status = ?, error_message = ?, workflow_url = ? where id = ?",
    )
    .run(body.status, errorMessage, workflowUrl || null, id);
  if (!result.changes) throw httpError(404, "Публикация каталога не найдена.");
  return sendJson(res, 200, { ok: true });
}
function listLeads(req, res, url) {
  const term = cleanText(url.searchParams.get("q"), 100).toLocaleLowerCase(
    "ru-RU",
  );
  const status = url.searchParams.get("status");
  const filters = [];
  const values = [];
  if (status && status !== "all" && validStatus(status)) {
    filters.push("status = ?");
    values.push(status);
  }
  if (term) {
    filters.push(
      "(lower(customer_name) like ? or phone like ? or lower(product_interest) like ?)",
    );
    values.push(`%${term}%`, `%${term}%`, `%${term}%`);
  }
  const where = filters.length ? "where " + filters.join(" and ") : "";
  const rows = db
    .prepare(`select * from leads ${where} order by created_at desc limit 500`)
    .all(...values);
  return sendJson(res, 200, rows);
}
async function addPublicLead(req, res) {
  const body = await readJson(req);
  if (body.website) return sendJson(res, 200, { ok: true });
  const ip = requestIp(req);
  const current = publicAttempts.get(ip) || {
    count: 0,
    reset: Date.now() + 60 * 60_000,
  };
  if (current.reset < Date.now()) {
    current.count = 0;
    current.reset = Date.now() + 60 * 60_000;
  }
  if (++current.count > 8)
    throw httpError(429, "Слишком много заявок. Попробуйте позже.");
  publicAttempts.set(ip, current);
  const name = cleanText(body.customer_name, 100);
  const phone = normalizedPhone(body.phone);
  const interest = cleanText(body.product_interest, 200);
  const source = cleanText(
    body.source_page || req.headers.referer || "snowenduro.ru",
    600,
  );
  const idempotency = cleanText(body.idempotency_key, 80);
  const yearValue =
    body.compatibility_year == null || body.compatibility_year === ""
      ? null
      : Number(body.compatibility_year);
  if (
    yearValue !== null &&
    (!Number.isInteger(yearValue) || yearValue < 1950 || yearValue > 2100)
  )
    throw httpError(400, "Проверьте год выпуска техники.");
  if (
    name.length < 2 ||
    phone.replace(/\D/g, "").length < 7 ||
    interest.length < 2
  )
    throw httpError(400, "Заполните имя, телефон и интересующий товар.");
  if (!body.consent || !/^([a-f0-9-]{36})$/i.test(idempotency))
    throw httpError(400, "Нужно подтвердить согласие на обработку данных.");
  const duplicate = db
    .prepare("select public_code from leads where idempotency_key = ?")
    .get(idempotency);
  if (duplicate)
    return sendJson(res, 200, { ok: true, code: duplicate.public_code });
  const id = randomUUID();
  const now = new Date().toISOString();
  const nextCode = Number(
    db
      .prepare("select coalesce(max(public_code), 0) + 1 as code from leads")
      .get().code,
  );
  db.prepare(
    `insert into leads (id, public_code, created_at, customer_name, phone, product_interest, source_page, compatibility_make, compatibility_model, compatibility_year, manager_comments, status, idempotency_key, consent_at, consent_policy_version)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'new', ?, ?, ?)`,
  ).run(
    id,
    nextCode,
    now,
    name,
    phone,
    interest,
    source,
    cleanText(body.compatibility_make, 100) || null,
    cleanText(body.compatibility_model, 100) || null,
    yearValue,
    idempotency,
    now,
    cleanText(body.consent_policy_version || "v1", 80),
  );
  const outboxId = randomUUID();
  db.prepare(
    "insert into notification_outbox (id, lead_id, state) values (?, ?, 'pending')",
  ).run(outboxId, id);
  void dispatchNotification(outboxId);
  return sendJson(res, 201, { ok: true, code: nextCode });
}
async function dispatchNotification(outboxId) {
  const outbox = db
    .prepare("select * from notification_outbox where id = ?")
    .get(outboxId);
  if (!outbox || outbox.state === "sent") return false;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const recipients = db
    .prepare("select chat_id from telegram_recipients where is_enabled = 1")
    .all();
  if (!token || !recipients.length) {
    db.prepare(
      "update notification_outbox set last_error = ? where id = ?",
    ).run(
      !token ? "Токен бота не настроен." : "Нет активных получателей.",
      outboxId,
    );
    return false;
  }
  const lead = db
    .prepare("select public_code, product_interest from leads where id = ?")
    .get(outbox.lead_id);
  if (!lead) return false;
  db.prepare(
    "update notification_outbox set state = 'running', attempt_count = attempt_count + 1, last_error = null where id = ?",
  ).run(outboxId);
  try {
    for (const { chat_id } of recipients) {
      await telegramCall(token, "sendMessage", {
        chat_id,
        text: `Новая заявка #${String(lead.public_code).padStart(4, "0")}\nИнтерес: ${telegramSafeInterest(lead.product_interest)}`,
      });
    }
    db.prepare(
      "update notification_outbox set state = 'sent', sent_at = ?, last_error = null where id = ?",
    ).run(new Date().toISOString(), outboxId);
    return true;
  } catch (error) {
    console.warn("Telegram notification failed:", error.message);
    db.prepare(
      "update notification_outbox set state = 'failed', last_error = ? where id = ?",
    ).run(cleanText(error.message, 300), outboxId);
    return false;
  }
}
function telegramSafeInterest(value) {
  const interest = cleanText(value, 200);
  const product = db
    .prepare(
      "select name from products where is_published = 1 and (lower(name) = lower(?) or lower(slug) = lower(?)) limit 1",
    )
    .get(interest, interest);
  if (product) return cleanText(product.name, 120);
  if (/совместим/i.test(interest)) return "Проверка совместимости Snowbike";
  if (/snowbike|сноубайк/i.test(interest)) return "Snowbike-комплект";
  if (/снегоход|snowmobile/i.test(interest)) return "Снегоход под заказ";
  return "Обращение с сайта";
}
async function updateLead(req, res, id) {
  const body = await readJson(req);
  const fields = [];
  if (body.status !== undefined) {
    if (!validStatus(body.status))
      throw httpError(400, "Неизвестный статус заявки.");
    fields.push(["status", body.status]);
  }
  if (body.manager_comments !== undefined)
    fields.push(["manager_comments", cleanText(body.manager_comments, 5000)]);
  if (!fields.length) throw httpError(400, "Нет изменений для сохранения.");
  db.prepare(
    `update leads set ${fields.map(([key]) => `${key} = ?`).join(", ")} where id = ?`,
  ).run(...fields.map(([, value]) => value), id);
  const lead = db.prepare("select * from leads where id = ?").get(id);
  if (!lead) throw httpError(404, "Заявка не найдена.");
  return sendJson(res, 200, lead);
}
function productRow(row) {
  return {
    ...row,
    data: JSON.parse(row.data_json),
    data_json: undefined,
    is_published: Boolean(row.is_published),
  };
}
async function saveProduct(req, res, id = null) {
  const body = await readJson(req);
  const data = body.data;
  if (!data || typeof data !== "object")
    throw httpError(400, "Карточка товара заполнена некорректно.");
  const slug = cleanText(body.slug, 120).toLowerCase();
  const name = cleanText(body.name || data.name, 160);
  if (
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    !name ||
    !["snowbike", "snowmobile"].includes(body.category)
  )
    throw httpError(400, "Проверьте название, адрес и категорию товара.");
  if (!data.gallery || !Array.isArray(data.gallery)) data.gallery = [];
  const now = new Date().toISOString();
  const availability = ["in_stock", "on_order", "out_of_stock"].includes(
    body.availability,
  )
    ? body.availability
    : "on_order";
  try {
    if (id)
      db.prepare(
        "update products set slug = ?, category = ?, name = ?, data_json = ?, availability = ?, is_published = ?, sort_order = ?, updated_at = ? where id = ?",
      ).run(
        slug,
        body.category,
        name,
        JSON.stringify(data),
        availability,
        body.is_published ? 1 : 0,
        Math.max(0, Number(body.sort_order) || 0),
        now,
        id,
      );
    else {
      id = randomUUID();
      db.prepare(
        "insert into products (id, slug, category, name, data_json, availability, is_published, sort_order, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        id,
        slug,
        body.category,
        name,
        JSON.stringify(data),
        availability,
        body.is_published ? 1 : 0,
        Math.max(0, Number(body.sort_order) || 0),
        now,
      );
    }
  } catch (error) {
    if (String(error.message).includes("UNIQUE"))
      throw httpError(409, "Адрес товара уже занят.");
    throw error;
  }
  const row = db.prepare("select * from products where id = ?").get(id);
  if (!row) throw httpError(404, "Товар не найден.");
  return sendJson(res, id && req.method === "PUT" ? 200 : 201, productRow(row));
}
async function uploadImage(req, res) {
  const body = await readJson(req);
  const mime = String(body.mimeType || "").toLowerCase();
  if (!allowedImageTypes.has(mime))
    throw httpError(400, "Поддерживаются JPG, PNG, WebP и AVIF.");
  const bytes = Buffer.from(String(body.base64 || ""), "base64");
  if (!bytes.length || bytes.length > 12 * 1024 * 1024)
    throw httpError(413, "Фото должно быть не больше 12 МБ.");
  const ext = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
  }[mime];
  const name = `${randomBytes(16).toString("hex")}.${ext}`;
  await writeFile(path.join(uploadDir, name), bytes, { flag: "wx" });
  return sendJson(res, 201, { src: `/uploads/${name}` });
}
async function saveRecipients(req, res) {
  const body = await readJson(req);
  const ids = Array.from(
    new Set(
      (body.chatIds || []).map((value) => String(value).trim()).filter(Boolean),
    ),
  );
  if (ids.some((id) => !/^-?\d{1,20}$/.test(id)))
    throw httpError(
      400,
      "Chat ID должен содержать только цифры; для групп допустим знак минус.",
    );
  db.exec("begin");
  try {
    const wanted = new Set(ids);
    for (const row of db
      .prepare("select id, chat_id from telegram_recipients")
      .all())
      if (!wanted.has(row.chat_id))
        db.prepare("delete from telegram_recipients where id = ?").run(row.id);
    const insert = db.prepare(
      "insert or ignore into telegram_recipients (id, chat_id, is_enabled) values (?, ?, 1)",
    );
    for (const chatId of ids) insert.run(randomUUID(), chatId);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  const rows = db
    .prepare(
      "select id, chat_id, is_enabled from telegram_recipients order by chat_id",
    )
    .all();
  return sendJson(
    res,
    200,
    rows.map((row) => ({ ...row, is_enabled: Boolean(row.is_enabled) })),
  );
}
async function telegramAction(req, res) {
  const body = await readJson(req);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token)
    throw httpError(503, "Токен Telegram-бота ещё не настроен на сервере.");
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
    return sendJson(res, 200, { chats: [...chats.values()] });
  }
  if (body.action === "retry") {
    const pending = db
      .prepare(
        "select id from notification_outbox where state in ('pending', 'failed') order by rowid limit 100",
      )
      .all();
    let sent = 0;
    for (const item of pending)
      if (await dispatchNotification(item.id)) sent += 1;
    return sendJson(res, 200, { sent, checked: pending.length });
  }
  const recipients = db
    .prepare("select chat_id from telegram_recipients where is_enabled = 1")
    .all();
  if (!recipients.length)
    throw httpError(400, "Сначала добавьте Chat ID получателей.");
  if (body.action === "test") {
    for (const { chat_id } of recipients)
      await telegramCall(token, "sendMessage", {
        chat_id,
        text: "Тестовое уведомление SnowEnduro CRM. Персональные данные клиентов не отправляются.",
      });
    return sendJson(res, 200, { sent: recipients.length });
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
    },
  );
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw httpError(502, data.description || "Telegram не ответил на запрос.");
  return data;
}
async function serveUpload(req, res, name) {
  if (!/^[a-f0-9]{32}\.(jpg|png|webp|avif)$/.test(name))
    throw httpError(404, "Файл не найден.");
  const fullPath = path.join(uploadDir, name);
  if (!existsSync(fullPath)) throw httpError(404, "Файл не найден.");
  const mime = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif",
  }[name.split(".").pop()];
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(fullPath).pipe(res);
}
async function serveStatic(req, res, pathname) {
  const requested = path.resolve(
    root,
    "dist",
    `.${decodeURIComponent(pathname)}`,
  );
  const dist = path.resolve(root, "dist");
  let target =
    requested.startsWith(dist + path.sep) ||
    requested === path.join(dist, "index.html")
      ? requested
      : path.join(dist, "index.html");
  if (!existsSync(target) || !target.startsWith(dist))
    target = path.join(dist, "index.html");
  const ext = path.extname(target);
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
  };
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(target).pipe(res);
}
function setSecurityHeaders(res) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  const devConnections = isDev ? " ws: wss:" : "";
  res.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'${devConnections}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`,
  );
}
