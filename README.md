# Scanora Celebrates

A standalone wedding-invitation QR platform using Node.js 22.17+, Express,
PostgreSQL/Neon and plain HTML/CSS/JavaScript. This directory can be moved out
of Scanora without code or asset dependencies on the parent project.

The database schema (`scanora_invites`) and session cookie name are retained for
compatibility; the project and portal branding are Scanora Celebrates.

## Workflow

1. Log in at `/admin/login`.
2. Enter a shop number (1-20 digits) and generate 1-1,000 unused QR cards. Download the ZIP of 1200px
   pure-red PNG QRs and supply them directly to shop owners.
3. A customer scans a QR. The unused `/g/<public-id>` link opens a public
   form for two names (up to 30 characters each) and a wedding date (1900-2099).
4. The customer checks the details and saves. One atomic update permanently
   activates the invitation. Subsequent scans open the saved invitation at
   the same URL. Competing submissions cannot overwrite the first activation.

New public QR identifiers are 8 random URL-safe characters; existing 32-character
links remain valid. Keep unused cards private: possession of the link permits activation.
The shop number is stored as `batch_id` (text, preserving leading zeros).
You can reuse it across generations. The administrator can filter by shop number;
counts and ZIP downloads combine all valid cards assigned to that number.
Old UUID batch IDs are preserved and remain downloadable.

There are no shop logins, shop dashboards, credit deductions, payments,
reset controls. Possession of an unused QR grants
permission to customize it; keep unused QR images private until sold.
After activation, anyone with /g/<qr-id>/edit can change the names, date and Maps link (no login; expiry is recalculated from the new date).
Batch history and downloads remain available to the administrator.

## Preserved template

Only Wedding invitation is offered. The original Love template and all its
assets are copied into [weds](weds), directly in the project root.
There is no templates container or Birthday template. The copied stylesheet,
script and video are named `weds.css`, `weds.js` and `weds.mp4`.
The opening video is the supplied Radha-Krishna animation, with its final frame
saved as `weds/assets/end-frame.png` for the still-image and reduced-motion views.
The keepsake screen shows the couple's names, a wedding countdown, an invitation
quote and a venue card. An optional Maps link displays a directions button; when
omitted, the card shows a decorative "With love & blessings" badge with no action.

[server/render.cjs](server/render.cjs) safely injects saved names, the wedding
date and local asset URLs. Dates start at midnight in `Asia/Kolkata`.
[weds/shared/calendar.js](weds/shared/calendar.js) retains the shared
timezone and countdown calculations.

## Setup

Run these commands from this directory, including after moving it:

```powershell
npm ci
Copy-Item .env.example .env
```

Edit your local `.env`:

- `DATABASE_URL`: a separate empty PostgreSQL/Neon database, or the existing
  Scanora connection **only with `DATABASE_SCHEMA=scanora_invites`**.
- `DATABASE_SCHEMA`: `scanora_invites` isolates this app's invitation table in the
  same database without accessing Scanora's default-schema tables. Migration
  creates the dedicated schema. Leave blank only for a separate empty database.
  Do not change this value after creating QR cards.
  With Neon, the **direct (unpooled) endpoint** is recommended. Pooled
  endpoints are also supported: app queries explicitly qualify tables in the
  configured schema instead of using a `search_path` startup option.
- `APP_URL`: `http://localhost:3001` locally; your stable HTTPS origin in production.
- `PORT`: `3001`, so local Scanora can keep using port 3000.
- `ADMIN_USERNAME` and `ADMIN_PASSWORD`: your administrator credentials.
  Alternatively use `ADMIN_PASSWORD_HASH` (scrypt), not both password settings.
- `SESSION_SECRET`: a stable random secret of at least 32 characters.
- `NODE_ENV`: `development` locally, `production` when deployed over HTTPS.

Generate a session secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
npm run migrate
npm start
```

Open http://localhost:3001/admin/login. `APP_URL` must exactly match the browser
origin for submissions. No credentials or parent `.env` are copied into this
project automatically. Its session cookie has a separate name from Scanora.
If reusing existing administrator credentials, copy them privately into this
project's own `.env`; use its own session secret.

## Database

Only the invitation table is required:

- `gifts`: blank QR rows, batch identifiers, public identifiers, and activated
  wedding names/dates and optional venue Maps links. There is no template-type column;
  a NULL wedding date identifies an unused QR.

Migration removes the legacy `shops` table and `gifts.shop_id` column from this
app's schema while preserving invitation rows. There are no shop-management or credit APIs.

`expires_at` is NULL for unused cards. A database trigger sets it to the wedding
date plus 7 days at midnight in `Asia/Kolkata` when details are saved (and
backfills existing invitations during migration). For January 1, 2027, expiry
is January 8, 2027 at 00:00 India time. Expired invitations are immediately
unavailable through public links. The server deletes expired rows on startup
and checks every 60 seconds while running. If the server is stopped, physical
deletion waits until the next startup; this is not a Neon-hosted scheduled job.

Expired or missing invitation links lead to a shared `/thank-you` page with a
generic gratitude note, without couple-specific details or expiry/error wording.
Missing customization links also redirect there. Database/server failures still
show an explicit error rather than being mistaken for an expired invitation.

Admin credentials live in server environment configuration. There are no
user, session, credit-history or migration-history tables.
Migration is transactional and repeatable for this project's own schema.

## Validation

```powershell
npm test
npm run test:local-db
```

The database test skips in `npm test` unless `TEST_DATABASE_URL` is provided.
`test:local-db` launches isolated temporary PostgreSQL and removes only its
temporary data afterwards. Database tests use their own random schema.
Tests cover admin access, absent shop routes, QR ZIP decoding, one-time
activation, concurrency, validation, unchanged Love assets and stable URLs.

For a template-only preview, run `npm run preview`, then open
http://127.0.0.1:4173/weds/. Stop that preview before using the same
port for another project. It does not access the database.

## Deployment and moving

Move this whole folder. Run `npm ci` at the destination rather than relying on
the parent project's installed packages. Keep `.env` private and configure a
dedicated database or isolated schema and stable HTTPS `APP_URL` before printing real QR cards.
Changing domain later requires redirects from the old domain to preserve QRs.

Production setup: `npm ci --omit=dev`, `npm run migrate`, then `npm start`.
Health is at `/health`. Use backups and monitoring. Rate limits are in-memory
for one server instance; multiple instances need shared rate limiting and
explicit trusted-proxy configuration. Public links are unlisted, not
confidential: anyone possessing a link can view the saved names and date.
