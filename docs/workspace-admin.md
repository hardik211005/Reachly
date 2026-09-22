# Public website and workspace administration

This document covers the public site, the in-app settings, integrations, billing and system health pages, and the services behind them.

## Public website

- **Routes** (`apps/web/app/(marketing)`, sharing one layout with the navigation, site search and footer):

  | Page | Path |
  |---|---|
  | Home | `/` (signed-in visitors are sent to `/app`) |
  | Platform overview | `/product` |
  | Product pages | `/product/lead-discovery`, `/ai-outreach`, `/ai-calling`, `/workflows`, `/crm-quotes`, `/analytics` |
  | Use cases | `/use-cases` and `/use-cases/agencies`, `/b2b-services`, `/manufacturers`, `/software` |
  | Pricing | `/pricing`, with a full comparison table built from the plan configuration |
  | About, security, contact | `/about`, `/security`, `/contact` |
  | Legal | `/privacy`, `/terms` |
  | Not found | A branded 404 page (`app/not-found.tsx`) |

- **SEO**: `app/sitemap.ts` and `app/robots.ts`. Private areas (`/app`, `/api`, invitations, public quotes, unsubscribe) are disallowed.
- **Content** lives in one file, `components/marketing/site.ts`: products, capabilities, use cases, FAQs and the search index.
  - It describes what the product does. There are no customer names, logos, testimonials or outcome statistics.
  - Product demos (`components/marketing/demos.tsx`) are animated illustrations, and each one is labelled "Example data".
- **Navigation**:
  - Desktop: dropdown menus for Product, Use cases and Company.
  - Mobile: a full-screen menu.
  - The current section is highlighted.
- **Site search**: opens with ⌘K, Ctrl+K or `/`. It searches pages, features, use cases and FAQs; every query word must match, and title matches rank first.
- **Contact form** (`POST /api/public/contact`, `packages/core/src/marketing/contact.ts`):
  - Messages are stored in `contact_requests`. The team is emailed at the support address and the sender gets a confirmation (both go to the log when no email provider is configured).
  - Spam controls: a hidden honeypot field, 5 messages per IP per 10 minutes (counted after validation), and duplicate suppression.
  - Only a SHA-256 hash of the IP is stored.

## Settings

`/app/settings` has a section menu:

| Section | What it does | Who can change it |
|---|---|---|
| General | Workspace name, time zone (searchable), currency, country | Admins |
| Your profile | Name, password (with strength meter), active sessions with sign-out, theme | You |
| Business & services | Business profile, the catalog of services and products with pricing rules and quote settings, and the AI-drafted ideal customer profile (edit or re-analyse) | Admins |
| Team | Invite by email, change roles, remove members, withdraw or resend invitations, leave the workspace | Admins (owners for owner changes) |
| Compliance | Sending window and days, approval of first messages, WhatsApp opt-in, postal address and email footer, opt-out phrases, AI calling consent and rules, block list | Admins |
| API keys | Create keys with scopes and expiry (shown once), revoke, quick-start example | Admins, on plans with API access |

### Invitations

- **Sending**: an invitation email links to `/invite/:token`.
  - The token is random and stored only as a SHA-256 hash. It expires after 7 days.
  - A new invitation to the same address replaces the old one.
  - Invitations count towards the plan's seat limit.
- **Accepting**: requires signing in with the invited address.
  - People without an account can sign up from the invitation. Their address is prefilled and they come back to the invitation afterwards.
  - Accepting is atomic, so a link works only once.
- **Role rules** (`packages/core/src/organizations/members.ts`):
  - Members can assign only roles at or below their own.
  - Only owners can create, change or remove owners.
  - The last owner can't be demoted or removed.

## Integrations

`/app/integrations` connects a workspace's own provider accounts (`packages/core/src/integrations/manage.ts`).

| Category | Providers |
|---|---|
| AI | Anthropic, OpenAI, Google Gemini (with a model choice) |
| Lead data | Google Places |
| Email | Resend, SendGrid, SMTP (with sender details) |
| WhatsApp | Meta WhatsApp Cloud API |
| Voice | Twilio, Vapi |
| Team notifications | Slack incoming webhook |

- **Storage**: each provider declares its fields. Secret fields are encrypted with AES-256-GCM, the rest are stored as configuration.
- **Secrets stay on the server**: the API returns only which secrets are set. Leaving a secret blank when editing keeps the stored value.
- **Default provider**: the most recently connected provider in a category becomes the one the product uses.
- **Webhook URLs**: shown for email (per connection), WhatsApp and voice providers.
- **Testing**: Slack can post a test message.
- **Status strip**: shows where each capability is served from.
  - Your account.
  - Provided by the operator's environment variables.
  - Demo (simulated).
  - Not set up.
- **Server-wide services**: n8n, Stripe and file storage are configured on the server and shown as status only.

## Billing

`/app/billing` shows:

- the current plan and usage period;
- a usage meter for each metered allowance, with warnings at 75% and 90%;
- the plans on offer;
- invoices.

Until a payment provider is configured, owners can switch plans directly. The page states that no payment is collected, and the change is audited. When Stripe is configured, plan changes go through checkout instead.

## System health

`/app/system` is for admins (`system:read`) and refreshes every 30 seconds (`packages/core/src/system/health.ts`).

- **Checks**:
  - database latency;
  - Redis and background workers (worker heartbeats), or the inline queue driver;
  - job queue backlog;
  - the AI provider in use;
  - failures in the last 24 hours.
- **Queue table**: per-queue counts (waiting, active, delayed, done, failed).
- **This workspace's failures** in the last 24 hours: failed workflow runs, messages, outbound webhook deliveries and inbound webhooks.
- **Background jobs that gave up**: filtered to this workspace, so admins never see another workspace's job data.
- **Providers in use and runtime details**: environment, demo mode, Node version, uptime.

## API

| Endpoint | Purpose |
|---|---|
| `GET/PATCH /api/v1/workspace` | Workspace settings |
| `GET /api/v1/team` | Members, pending invitations, seats, assignable roles |
| `POST /api/v1/team/invitations`, `DELETE /api/v1/team/invitations/:id` | Invite, withdraw |
| `PATCH/DELETE /api/v1/team/members/:id` | Change role, remove (or leave) |
| `POST /api/v1/invitations/accept` | Accept an invitation (signed-in user) |
| `GET/POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/:id` | API keys |
| `GET /api/v1/integrations`, `PUT/DELETE /api/v1/integrations/:provider`, `POST …/test` | Integrations |
| `GET/PUT /api/v1/compliance`, `PUT /api/v1/compliance/calling` | Compliance settings |
| `GET/POST /api/v1/compliance/suppressions`, `DELETE …/:id` | Block list |
| `GET /api/v1/billing`, `POST /api/v1/billing/plan` | Billing overview, plan change without payment |
| `GET /api/v1/system/health` | System health |
| `POST /api/public/contact` | Public contact form |
