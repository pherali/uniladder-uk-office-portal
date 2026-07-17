# Uniladder UK Office Portal

A deployable wage and hours tracker for a small UK office manager. The frontend is a static React/Vite app hosted by Netlify; Supabase provides authentication, Postgres persistence and row-level security; Netlify Functions send reports through Resend.

## Decisions used in this build

- **“Money earned so far” means the current calendar month.** It resets in the dashboard when a new month starts.
- **Past time entries are retained and viewable** through the Monthly History page.
- The scheduled function runs on the **1st of each month at 08:00 UTC** and sends the **previous month’s** report.
- Payroll is calculated from each employee’s **current** hourly wage. For audit-grade payroll with wage changes over time, add a wage-history table or store the applicable wage on each time entry.

## Features

- Manager registration and login using Supabase Auth email/password
- Manager username stored in a protected `manager_profiles` table
- Per-manager employee CRUD with Supabase row-level security
- Date-specific time entries, current-month totals and pay owed
- Sortable/searchable employee dashboard
- Employee detail page with daily entries and deletion
- Historical month selector
- Manual email report button
- Scheduled monthly reports using the same shared report code
- Responsive, light, minimalist UI

## 1. Create and configure Supabase

1. Create a new project at Supabase.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. In **Authentication → Providers → Email**, enable Email/Password.
4. Choose whether email confirmation is required:
   - For production, leave confirmation enabled and configure your site URL.
   - For local testing, you may temporarily disable confirmation.
5. In **Authentication → URL Configuration**, set:
   - Site URL: your deployed Netlify URL
   - Redirect URLs: `http://localhost:8888/**` and your Netlify URL pattern
6. Copy the project URL, anon key and service-role key from **Project Settings → API**.

> Security: `VITE_SUPABASE_ANON_KEY` is intentionally browser-visible and protected by RLS. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and must exist only in Netlify’s server-side environment variables.

## 2. Configure Resend

1. Create a Resend account and API key.
2. Verify a sending domain.
3. Pick a sender such as `Uniladder Office <reports@ukuniladder.com>`.
4. Store the API key and sender in Netlify environment variables; never commit them.

## 3. Local development

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local`. For the full app including Netlify Functions, install the Netlify CLI and run:

```bash
npm install -g netlify-cli
netlify dev
```

Open the local URL shown by Netlify CLI, usually `http://localhost:8888`.

Running only `npm run dev` serves the Vite frontend, but the manual email function will not be available unless proxied through Netlify Dev.

## 4. Environment variables

Add these in **Netlify → Site configuration → Environment variables**:

| Variable | Used by | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | Browser app | No |
| `VITE_SUPABASE_ANON_KEY` | Browser app | Public client key |
| `SUPABASE_URL` | Netlify Functions | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Netlify Functions | **Yes** |
| `RESEND_API_KEY` | Netlify Functions | **Yes** |
| `REPORT_FROM_EMAIL` | Netlify Functions | No |

Use the same Supabase URL for both URL variables. Do not prefix server secrets with `VITE_`.

## 5. Deploy to Netlify

### Git-based deploy

1. Push this folder to GitHub, GitLab or Bitbucket.
2. In Netlify, choose **Add new site → Import an existing project**.
3. Netlify reads `netlify.toml` automatically:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Add all environment variables listed above.
5. Deploy.
6. Return to Supabase and add the final Netlify URL to Auth URL Configuration.

### Netlify CLI deploy

```bash
npm install
npm run build
netlify deploy --prod
```

## Scheduled report behaviour

`netlify.toml` contains:

```toml
[functions."monthly-report"]
  schedule = "0 8 1 * *"
```

Netlify scheduled functions run in UTC. On the first day of a month, `monthly-report.js` calculates the previous month, finds managers who have employees, and emails each manager separately. Failures for one manager do not stop the remaining reports.

The dashboard’s **Send report now** button calls `send-report.js` with the manager’s Supabase access token. The function verifies the token with Supabase before using the server-only service-role key.

## Production considerations

- Confirm the lawful basis and retention period for employee working-time/pay data.
- Add an audit log before using this as a formal payroll system.
- Add wage history if hourly rates may change, because this build recalculates historical totals using the current wage.
- Add manager-controlled report recipients if reports should go to a finance address rather than the login email.
- Consider rate limiting the manual report endpoint.
