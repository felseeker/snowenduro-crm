# SnowEnduro CRM

Closed admin CRM for website leads, catalog editing, and Telegram notifications. The app and API run together in Node.js with a local SQLite database. This release uses no Docker, Supabase, cloud database, or paid hosting.

## Run locally

Requirements: Node.js 24 and npm.

On Windows, start `Start-SnowEnduroCRM.cmd`. It builds the app and stores the database and photos in `%LOCALAPPDATA%\SnowEnduroCRM\data`, outside the project and OneDrive. The server listens only on this computer at `http://127.0.0.1:4173`; the script does not open a browser automatically. Create the administrator on the first visit.

For development only:

```powershell
npm ci
npm run dev
```

The development command stores data under the repository's ignored `data/` folder. Do not use that path for real customer data if the project folder is synchronized to a cloud drive. The first catalog cards are loaded from `server/catalog-seed.json`.

For a production build on the same machine:

```powershell
npm run build
npm start
```

The default server listens only on `127.0.0.1`. Do not expose it to the internet until HTTPS, server location, backups, privacy notice, and consent text are configured. Set `HOST`, `PORT`, and `CRM_DATA_DIR` in an untracked `.env` file when needed; see `.env.example`.

## Website form

The server provides `POST /api/public/leads` for new enquiries and `GET /api/public/products` for published product cards. The public lead endpoint validates consent and an idempotency key, limits repeated requests, and never includes customer name or phone in Telegram notifications. Set `WEBSITE_ORIGIN` to the exact website origin before allowing cross-origin form requests.

The public GitHub Pages preview serves only static files. GitHub Pages cannot run this Node.js server or SQLite database. It cannot accept or store real leads. This local release is not connected to the live website; the site's public form remains in no-send mode until a separate HTTPS server in Russia is provided.

Catalog publication uses the existing GitHub Actions workflow in `felseeker/snowenduro-site`. After that workflow is installed, set `GITHUB_TOKEN` with write access to that repository and a matching `SYNC_CALLBACK_TOKEN` on the CRM server. The CRM asks Actions to fetch the published catalog, copy CRM-uploaded product photos into the site repository, rebuild the static pages, and report the result. No customer records are sent to GitHub. Keep real website forms disabled until `/privacy` describes the actual data handling and the consent text has been reviewed.

## Optional Telegram notifications

Create a Telegram bot through [@BotFather](https://t.me/BotFather), then add its token to `%LOCALAPPDATA%\SnowEnduroCRM\.env` as `TELEGRAM_BOT_TOKEN`. Each recipient must open the bot and press `/start`; then add the Chat ID in the CRM. Notifications contain only the lead number and product category, without personal data.

## Data and backups

- Customer records: `%LOCALAPPDATA%\SnowEnduroCRM\data\crm.sqlite`
- Uploaded product photos: `%LOCALAPPDATA%\SnowEnduroCRM\data\uploads\`
- Stop the server and back up the `data` folder. Do not put backups in the public repository.
- `GET /api/public/products` returns only published product data; it contains no customer records.
- The public website form remains in no-send mode. Do not enable it before a public API is hosted with HTTPS and the privacy notice is updated.

## Build

```powershell
npm run build
```
