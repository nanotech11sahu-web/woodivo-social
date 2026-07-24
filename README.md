# Woodivo Social Publisher

A production-ready NestJS service that automatically publishes content prepared by
Woodivo to Facebook Pages and Instagram Business accounts.

Woodivo's backend submits a finished post (media + a structured brief) over
HTTP - there is no shared filesystem between the two apps, and none is
needed. Media is stored in Cloudinary and job state in MongoDB from the
moment a post is submitted, so nothing about a pending post depends on this
service's own disk surviving a restart or redeploy between submission and
its scheduled publish time.

## Pipeline

```
POST /posts (Woodivo -> this app)
  -> upload media to Cloudinary, create PublishJob row (status PENDING)

Cron scheduler (4x/day by default, or triggered early via "Post Now")
  -> pick up to 1 PENDING job per content type (product / blog / other)
  -> [BullMQ] ai-generation queue    -> AiService.generateSocialContent() (Groq)
  -> [BullMQ] media-processing queue -> Sharp (images) / FFmpeg (video), re-uploaded to Cloudinary
  -> [BullMQ] publishing queue       -> Meta Graph API (Facebook + Instagram), from the Cloudinary URL
  -> [BullMQ] archiving queue        -> finalize status (COMPLETED / FAILED) in MongoDB
```

Every stage carries independent exponential backoff retries (BullMQ). When a
stage exhausts its retries, the `retry` queue records the failure history,
sends a failure email, and marks the job FAILED. A failure in one post never
affects the scheduler or any other post.

Each scheduled run picks **one job per content type** (product, blog, other)
rather than one job overall - so a large batch of bulk-submitted products can
never starve blog posts (or vice versa) out of a run.

## seo.txt format

The `seo` field in the ingest request is line-based `Label: value` pairs.
Recognized labels (case-insensitive):

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

```
POST /posts
Header: x-api-key: <INGEST_API_KEY>
Content-Type: multipart/form-data

Fields:
  media          - the image or video file
  seo            - raw seo.txt-formatted text (see above)
  sourceType     - optional: PRODUCT | BLOG | OTHER (default OTHER)
  sourceId       - optional: the id of the originating Woodivo product/blog
  sourceTitle    - optional: display title, shown in status listings
  urgent         - optional: "true" for "Post Now" (see below)
```

Response: `201 { "reference": "post-<timestamp>-<id>", "jobId": "...", "status": "pending" }`

Example:
```bash
curl -X POST https://<this-app-host>/posts \
  -H "x-api-key: $INGEST_API_KEY" \
  -F "media=@media.jpg" \
  -F "seo=Title: ...
Description: ...
Platforms: Facebook, Instagram
Language: English" \
  -F "sourceType=PRODUCT" \
  -F "sourceId=64f0..." \
  -F "sourceTitle=Handcrafted Oak Table"
```

### Post Now (`urgent` + `POST /posts/trigger-now`)

Submitting with `urgent=true` makes that post win the pick for its content
type over any non-urgent PENDING jobs, regardless of submission order. Follow
up immediately with:

```
POST /posts/trigger-now
Header: x-api-key: <INGEST_API_KEY>
```

to process pending jobs right away instead of waiting for the next scheduled
slot (returns `{ "triggered": true }`, or `false` if a tick was already running).

### Status listing (`GET /posts`, `GET /posts/:id`)

Both API-key guarded. `GET /posts?page=1&limit=20` returns a paginated list
with status and live Facebook/Instagram permalinks per job - this is what
Woodivo's CMS "Social Posts" page reads directly (no separate database on
Woodivo's side). `GET /posts/:id` returns full detail including the parsed
seo.txt, generated captions, and retry history.

## Architecture

Clean, modular NestJS structure - one responsibility per module:

| Module | Responsibility |
|---|---|
| `config` | Typed, validated env configuration (Joi) |
| `prisma` | MongoDB persistence via Prisma |
| `logger` | Structured logging (Pino) |
| `parser` | seo.txt text -> structured `SeoData` |
| `ai` | `AIProvider` abstraction + Groq implementation, `generateSocialContent()` |
| `cloudinary` | Media storage - upload/download, used by ingest and media processing |
| `media` | Sharp/FFmpeg validation & processing (in-memory for images, temp files for video) |
| `meta` | Shared Meta Graph API HTTP client |
| `facebook` / `instagram` | Platform-specific publishing (both URL-based, no local file access) |
| `mail` | Failure email notifications |
| `queue` | BullMQ queues, producers, processors, Prisma job repository |
| `scheduler` | Cron-driven pickup of PENDING jobs from MongoDB |
| `health` | Terminus health checks (MongoDB, Redis, Cloudinary) |
| `ingest` | `POST /posts` HTTP hand-off + status API |
| `shared` | Cross-cutting exceptions, utils, constants |

## Setup

```bash
cp .env.example .env
# fill in DATABASE_URL (MongoDB), REDIS_*, META_*, GROQ_API_KEY, CLOUDINARY_*, SMTP_*, INGEST_API_KEY

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

Health check: `GET /health` (checks MongoDB, Redis, and Cloudinary connectivity)

### Deployment note: Docker required

Render's (and most PaaS) standard Node build environment has no `ffmpeg`/
`ffprobe` binaries and no way to install them. This repo includes a
`Dockerfile` that installs ffmpeg via apt in the runtime image - deploy this
as a **Docker** service, not a native Node service.

### Why no persistent disk is needed

Earlier versions of this app used a local folder (`pending/processing/completed/failed`)
to track post state, which meant a container restart between submission and
the scheduled publish slot could lose an in-flight post. That's no longer the
case: media is uploaded to Cloudinary and the job record is created in
MongoDB immediately on submission (`POST /posts`), before anything else
happens. Local disk is only ever touched transiently, for the few seconds a
video job is actively being transcoded by FFmpeg - never for anything that
needs to survive a restart. No Render persistent disk (or equivalent) is
required.
