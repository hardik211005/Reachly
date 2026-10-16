# Grow: get found, build trust, keep customers

Leads and campaigns help a business *find and win* customers. **Grow** (`/app/grow`) covers the rest of growth: customers finding the business, trust from genuine reviews, and repeat business after every win. Code: `packages/core/src/grow/service.ts`; the after-win step runs as the `grow` event subscriber (`packages/core/src/jobs/grow.ts`).

## Public page — `/b/<workspace-slug>`

A page each business can share on WhatsApp, Instagram, Google Maps and visiting cards. It's off until the owner turns it on in Grow.

- **Shows**: name, logo, industry and city, a headline and an "about" (each falls back to the business profile), services from the catalog with prices (or "ask for a quote" when **Show prices** is off), published reviews with the average rating, and an enquiry form.
- **Indexed by search engines.** Free traffic for the business. Review links (`/r/`) are excluded in `robots.txt`.
- **Enquiries** (`POST /api/public/pages/<slug>/enquiry`):
  - The person leaves a name, an email or phone, and a message.
  - That becomes a lead with source **INBOUND** and status **Interested**, with the person as a contact and the message as a note.
  - The status change opens a **deal** in the CRM and fires workflows like any other lead.
  - The owner gets a notification.
  - The same email or phone enquiring again adds a note to the existing lead instead of duplicating it.
  - Inbound leads never use lead credits.
  - Abuse controls: a honeypot field, 5 enquiries per IP per 10 minutes (only a hash of the IP is used), and validation.

## Reviews — only from real customers

- The owner asks a specific customer from the lead's **⋯ → Ask for a review** menu, or automatically after a win.
  - That creates a private, unguessable link `/r/<token>` and a ready message with **Send on WhatsApp** (to the customer's number when known) or **Copy**.
  - Asking again before they answer reuses the same link.
- The customer picks 1–5 stars, writes a comment, and adds their name and (optionally) their business. Each link works **once**.
- Reviews appear on the public page straight away with a **Verified customer** badge. The owner can hide or show any review in Grow.
- There is no open review form, so the page can never carry invented reviews. This matters under India's rules on fake reviews.

## After a win

When a deal is won (`deal_won`), and **After a win** is on (the default), Reachly prepares:

- a private review link for that customer;
- a task **"Ask <customer> for a review"**, due in 3 days, with the link in its description;
- a task **"Check in with <customer> for repeat business"**, due in 30 days.

This runs once per deal, however many times the event is replayed.

## Numbers

The Grow page shows enquiries in the last 30 days, the average rating, how many reviews are shown, and how many review requests are still waiting.

## API

| Method | Path | |
|---|---|---|
| GET/PUT | `/api/v1/grow/page` | Public page settings (admins change) |
| GET/POST | `/api/v1/grow/reviews` | List reviews / create a review link `{leadId}` or `{dealId}` |
| PATCH | `/api/v1/grow/reviews/<id>` | `{visible}`: show or hide a review |
| POST | `/api/public/pages/<slug>/enquiry` | Public enquiry form |
| POST | `/api/public/reviews/<token>` | Public review submission |
