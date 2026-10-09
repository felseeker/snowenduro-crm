# SnowEnduro CRM

Closed admin CRM for website leads and product catalog management. The browser app and backend run in one Node.js process; records and uploaded product photos stay in the local `data/` directory. No Docker, Supabase, or hosted database is used.

## Run locally

Requirements: Node.js 24 and npm.

```powershell
npm ci
npm run dev
```

Open `http://127.0.0.1:4173`. On first launch, create the administrator account. Use a unique password with at least 12 characters. The SQLite database is created automatically at `data/crm.sqlite`; the first catalog cards are loaded from `server/catalog-seed.json`.

For a production build on the same machine:

```powershell
npm run build
npm start
```

The default server listens only on `127.0.0.1`. Do not expose it to the internet until HTTPS, server location, backups, privacy notice, and consent text are configured. Set `HOST`, `PORT`, and `CRM_DATA_DIR` in an untracked `.env` file when needed; see `.env.example`.

## Website form

The server provides `POST /api/public/leads` for new enquiries and `GET /api/public/products` for published product cards. The public lead endpoint validates consent and an idempotency key, limits repeated requests, and never includes customer name or phone in Telegram notifications. Set `WEBSITE_ORIGIN` to the exact website origin before allowing cross-origin form requests.

The current public GitHub Pages preview serves only static files. GitHub Pages cannot run this Node.js server or SQLite database. It therefore cannot accept or store real leads until the app and API are running together on a server.

Catalog publication uses the existing GitHub Actions workflow in `felseeker/snowenduro-site`. After that workflow is installed, set `GITHUB_TOKEN` with write access to that repository and a matching `SYNC_CALLBACK_TOKEN` on the CRM server. The CRM asks Actions to fetch the published catalog, copy CRM-uploaded product photos into the site repository, rebuild the static pages, and report the result. No customer records are sent to GitHub. Keep real website forms disabled until `/privacy` describes the actual data handling and the consent text has been reviewed.

## Optional Telegram notifications

Create a Telegram bot through [@BotFather](https://t.me/BotFather), then add its token to the server's untracked `.env` file as `TELEGRAM_BOT_TOKEN`. Each recipient must open the bot and press `/start`; then add the Chat ID in the CRM. Notifications contain only the lead number and product interest.

## Data and backups

- Customer records: `data/crm.sqlite`
- Uploaded product photos: `data/uploads/`
- Back up both paths together. Neither belongs in the public repository.
- `GET /api/public/products` returns only published product data; it contains no customer records.
- The public website form remains in no-send mode unless `NEXT_PUBLIC_CRM_LEADS_ENABLED=true` is set at build time and the CRM URL is configured. Do not enable it before the privacy notice is updated.

## Build

```powershell
npm run build
```
