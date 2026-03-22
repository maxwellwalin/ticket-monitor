# Ticket Monitor

Cross-platform ticket price monitor with email alerts. Tracks events across Ticketmaster, SeatGeek, StubHub, and Vivid Seats — alerts you when tickets drop below your price threshold.

## How It Works

```
Vercel Cron (every 30 min)
  ├─ Ticketmaster API    → discover events + face-value prices
  ├─ SeatGeek API        → discover events + resale prices
  ├─ Redis price cache   → cross-platform scraped prices
  ├─ Alert engine        → price match, price drop, presale, tickets available
  └─ Resend email        → "QOTSA $147 on StubHub, $198 on Vivid Seats"

Local Mac Scraper (every 30 min via launchd)
  ├─ Ticketmaster pages  → scrape prices missing from API (direct connection)
  ├─ StubHub pages       → search + scrape resale prices (via proxy)
  ├─ Vivid Seats pages   → search + scrape resale prices (direct connection)
  └─ Redis               → cache all scraped prices (2h TTL)
```

## Setup

### 1. Environment Variables

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `TICKETMASTER_API_KEY` | Yes | From [developer.ticketmaster.com](https://developer.ticketmaster.com) |
| `RESEND_API_KEY` | Yes | From [resend.com](https://resend.com) |
| `UPSTASH_REDIS_REST_URL` | Yes | From [upstash.com](https://upstash.com) |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | From Upstash |
| `CRON_SECRET` | Yes | Any random string — protects the cron endpoint |
| `ALERT_EMAIL` | Yes | Email address for alerts |
| `SEATGEEK_CLIENT_ID` | Optional | From [seatgeek.com/account/develop](https://seatgeek.com/account/develop) |

### 2. Watchlist

Edit `watchlist.yml` to configure your artists and price thresholds:

```yaml
settings:
  email: "you@example.com"  # Overridden by ALERT_EMAIL env var
  default_max_price: 100
  alert_cooldown_hours: 6
  geo_filter:
    lat: 34.0522
    lon: -118.2437
    range: "60mi"

artists:
  - name: "Tame Impala"
    max_price: 200
  - name: "Radiohead"
    max_price: 150

events: []
```

### 3. Install & Test

```bash
bun install
bun run test:local    # Discover events + show cross-platform prices
bun run scrape        # Run the price scraper once
```

### 4. Deploy to Vercel

```bash
vercel deploy
```

Set all env vars in Vercel dashboard. The cron runs every 30 minutes automatically.

### 5. Install Local Scraper (macOS)

```bash
bash scripts/install-scraper-cron.sh
```

This installs a launchd job that runs the scraper every 30 minutes. Requires `.env` file in the project root.

## Architecture

- **`src/monitor.ts`** — Main orchestrator: discover events → enrich prices → detect alerts → send email
- **`src/discovery.ts`** — Shared event discovery across all platform APIs
- **`src/prices/`** — PriceStore: batch Redis reads/writes for cross-platform price cache
- **`src/alerts/`** — Rule-based alert engine with ports & adapters (Redis state, Resend sender)
- **`src/platforms/`** — Platform adapters: Ticketmaster, SeatGeek (APIs)
- **`scripts/scrapers/`** — Playwright scrapers: Ticketmaster, StubHub, Vivid Seats
- **`api/cron.ts`** — Vercel serverless cron endpoint

## Alert Types

| Type | Trigger |
|---|---|
| **Price Match** | Ticket price ≤ your max price (API-sourced) |
| **Tickets Available** | Scraped price ≤ your max price |
| **Price Drop** | Price decreased since last check |
| **Presale Opening** | Presale starts within 24 hours |

## Tech Stack

- **Runtime**: Bun + TypeScript
- **Hosting**: Vercel (serverless cron)
- **State**: Upstash Redis
- **Email**: Resend
- **APIs**: Ticketmaster Discovery, SeatGeek
- **Scraping**: Playwright (headless Chromium)
- **Scraping**: Direct connections (no proxy needed)
