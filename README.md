# Woodivo Social Publisher

A production-ready NestJS service that automatically publishes content prepared by
Woodivo to Facebook Pages and Instagram Business accounts.

It watches a folder structure:

```
social-posts/
├── pending/       # Woodivo drops finished post folders here
├── processing/    # currently being handled
├── completed/     # successfully published
└── failed/        # unrecoverable errors (with email alert)
```

Each folder under `pending/` must contain:
- `media.jpg` / `media.mp4` (exactly one supported image or video file)
- `seo.txt` (structured brief - see below)

Folders can arrive in `pending/` two ways:
1. **Same machine/disk** - Woodivo (or you, for testing) writes directly into `pending/`.
2. **Separate deployments** - Woodivo's backend calls `POST /posts` on this app (see
   [Ingest API](#ingest-api-post-posts) below). This is required once the two apps run as
   separate services (e.g. two Render services) and no longer share a filesystem.

## Pipeline

```
Cron scheduler
  -> move one pending/ folder to processing/
  -> validate (media + seo.txt present)
  -> [BullMQ] ai-generation queue    -> AiService.generateSocialContent() (Groq)
  -> [BullMQ] media-processing queue -> Sharp (images) / FFmpeg (video)
  -> [BullMQ] publishing queue       -> Meta Graph API (Facebook + Instagram)
  -> [BullMQ] archiving queue        -> move to completed/ or failed/
```

Every stage carries independent exponential backoff retries (BullMQ). When a
stage exhausts its retries, the `retry` queue records the failure history,
sends a failure email, and routes the post to `failed/`. A failure in one
post never affects the scheduler or any other post.

## seo.txt format

Line-based `Label: value` pairs. Recognized labels (case-insensitive):

```
Title: ...
Description: ...
Keywords: comma, separated, keywords
Tone: professional / playful / etc.
CTA: Call us today!
Website: https://example.com
Phone: +1 555 0100
Platforms: Facebook, Instagram
Language: English
Additional Instructions: any extra notes for the AI
```

## Ingest API (`POST /posts`)

Lets Woodivo's backend hand off a finished post over HTTP instead of writing
to a shared disk - needed because this app and Woodivo are deployed as
separate services and don't share a filesystem in production. The endpoint
writes into this app's own `pending/` folder; the scheduler then picks it up
exactly as if it had appeared there directly - no pipeline changes involved.

```
POST /posts
Header: x-api-key: <INGEST_API_KEY>
Content-Type: multipart/form-data

Fields:
  media  - the image or video file
  seo    - raw seo.txt-formatted text (same format as below)
```

Response: `201 { "folderName": "post-<timestamp>-<id>", "status": "queued" }`

Example:
```bash
curl -X POST https://<this-app-host>/posts \
  -H "x-api-key: $INGEST_API_KEY" \
  -F "media=@media.jpg" \
  -F "seo=Title: ...\nDescription: ...\nPlatforms: Facebook, Instagram\nLanguage: English"
```

## Architecture

Clean, modular NestJS structure - one responsibility per module:

| Module | Responsibility |
|---|---|
| `config` | Typed, validated env configuration (Joi) |
| `prisma` | MongoDB persistence via Prisma |
| `logger` | Structured logging (Pino) |
| `parser` | seo.txt -> structured `SeoData` |
| `ai` | `AIProvider` abstraction + Groq implementation, `generateSocialContent()` |
| `media` | Sharp/FFmpeg validation & processing, carousel-ready |
| `meta` | Shared Meta Graph API HTTP client |
| `facebook` / `instagram` | Platform-specific publishing |
| `mail` | Failure email notifications |
| `archive` | Moves folders to completed/failed |
| `queue` | BullMQ queues, producers, processors, Prisma job repository |
| `scheduler` | Cron watcher for `pending/` |
| `health` | Terminus health checks (DB, Redis, filesystem) |
| `ingest` | `POST /posts` HTTP hand-off for cross-service deployments |
| `shared` | Cross-cutting exceptions, utils, constants |

## Setup

```bash
cp .env.example .env
# fill in DATABASE_URL (MongoDB), REDIS_*, META_*, GROQ_API_KEY, SMTP_*, PUBLIC_MEDIA_BASE_URL

npm install
npm run prisma:generate
npm run prisma:push   # creates collections in your MongoDB database (no migration files - Mongo has no schema migrations)
npm run start:dev
```

Persistence is MongoDB via Prisma. Each model is its own collection
(`publish_jobs`, `post_logs`, `retry_history`, `ai_responses`, `meta_responses`,
`publishing_history`) created automatically inside whatever database
`DATABASE_URL` points to - it will not touch any other collections already in
that database.

Health check: `GET /health`

### Instagram publishing note

Instagram's Graph API requires media to be fetchable from a public URL (it
does not accept direct binary uploads like Facebook does). This service
temporarily serves processed media at `PUBLIC_MEDIA_BASE_URL` (backed by
`PUBLIC_MEDIA_DIR`, served via `/public-media`) for the duration of the
publish call, then deletes it. In production, point `PUBLIC_MEDIA_BASE_URL`
at a domain/tunnel that reaches this app.
