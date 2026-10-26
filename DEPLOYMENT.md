# NanT on Vercel

**Latest release check:** [26 October source-reader fixes and acceptance results](RELEASE-CHECK-2026-10-26.md). The originally omitted Python explanation is recovered; the two sampled chapters complete. Use public-beta language and retain the documented review/capacity limits.

The public site is a static web app plus one stateless Node function. The browser runs a 5–10-minute chapter as resumable 30-second source reads and bounded paragraph-writing requests. Completed steps and chapters are saved in IndexedDB on the visitor's device. The existing `npm start` desktop app still uses local Ollama, Whisper and original video frames.

## Free launch setup

1. Import this repository into a **Vercel Hobby** project. `vercel.json` sets the build command (`npm run build`), output directory (`dist`) and function duration. Hobby is for personal, noncommercial projects. Review the hosting plan before introducing paid/commercial use.
2. Create a Google AI Studio API key in a project **without billing enabled**. Add `GEMINI_API_KEY` as a **server-side Secret** in Vercel, plus `GEMINI_FREE_TIER_CONFIRMED=true`. The default source reader is `gemini-3.6-flash` with high-resolution video input, and the default writer is `gemini-3.5-flash-lite`. Both use the same shared Gemini key. The allowlist also includes `gemini-3.8-flash`, `gemini-3.5-flash` / `gemini-3.5-flash-lite` and the older `gemini-2.5-flash` / `gemini-2.5-flash-lite` models for existing accounts. New accounts may be refused access to older models. The confirmation is an operator assertion: NanT cannot inspect Google's billing status, and those same models have paid tiers on billed projects.
3. Create or claim an **Upstash Redis Free** database. Set its `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as server-side Secrets. Temporary unclaimed databases expire; claim one before a durable public launch. Hashed connection counters expire after two days. Provider cooldowns and machine-read public YouTube source are also stored there; public source expires after 24 hours. Supplied private transcripts, completed chapters and API keys are not cached in Redis.
4. Optionally add `OPENROUTER_API_KEY` as a server-side Secret for automatic writing fallback after Gemini is unavailable. OpenRouter requests use `openrouter/free`, required structured output and zero-price routing. OpenRouter alone cannot read clipped YouTube URLs in this implementation; Gemini is still required for video source acquisition. The source reader tries `GEMINI_MODEL` followed by `GEMINI_VIDEO_FALLBACK_MODELS` (default `gemini-3.5-flash-lite,gemini-3.8-flash`), restricted to the free-tier allowlist. There is no paid fallback and no rotation through accounts or keys to evade provider limits.
5. Deploy and test one real public chapter end to end. Check the original speech/code against the written result. A successful sample or mocked model test does not establish real-source fidelity.

Do not prefix any secret with a browser/public environment prefix. Do not commit `.env`, `.env.local`, `.vercel`, `.local-data`, `.tools` or generated course material. The static builder uses an explicit public-file allowlist; `.vercelignore` excludes recordings and local runtime state from uploads.

## Limits and costs

`CLOUD_DAILY_REQUESTS` defaults to **80 provider attempts across everyone**. The daily per-connection cap is disabled by default (`CLOUD_VISITOR_DAILY_REQUESTS=0`); a positive value optionally enables one. An atomic Redis script retains six attempts per connection per minute and fails closed if the shared counter is unavailable. Each actual fallback attempt reserves capacity separately. A typical uncached 5-minute video uses ten source reads and roughly three writing requests, before retries. Each source read covers three fixed 10-second speech cells. Writing batches contain at most twelve cells and approximately 8,000 input characters; meaningful paragraphs can cross source-part boundaries.

Machine-read public YouTube source parts are reused for **24 hours**, keyed by reader revision, canonical video URL and exact time window. Reader upgrades invalidate old video progress while retaining its chapter setup. Cache hits do not use provider attempts. Supplied transcripts and private notes are never cached on the server. Provider cooldowns also persist in Redis, so another serverless instance skips models already known to be busy or exhausted. Google daily quota responses with a daily metric are held until Pacific midnight; temporary throttles use bounded waits. NanT's own shared counter resets at 00:00 UTC, independently of provider resets.

The browser saves progress and retries short throttles up to twice. Source reading still stops honestly when every compatible video model is unavailable. If source reading has finished and writing providers are unavailable or return unusable output, the app finishes a labelled source-preserving draft with all acquired wording and code; it does not claim a polished rewrite. Existing exports remain available. Free capacity is finite: disabling the per-connection cap does not make the service unlimited.

The app does not buy credits, enable billing, select paid fallbacks, or upgrade hosting/database plans. Free allowances are finite and availability is not guaranteed. Setting a model key on a billed Gemini project can still incur charges; application-level counters are a usage cap, not a provider billing switch.

Source bundles on the web app are limited to 1.5 MB. Raw recording uploads, local speech inference, original video-frame capture and whole-video background processing remain available in the desktop version. The hosted edition reads public YouTube videos through Gemini, or accepts supplied timestamped transcripts and visual records. It preserves acquired cues and separate code states but cannot prove all video content was acquired. Unreadable required code stops a source read. Independent semantic verification is not yet implemented on this path.

## Privacy

The public app sends the selected video URL to Google for clipped video understanding. Extracted/supplied text and visual records go to Google, or OpenRouter on fallback, for writing. Free-tier providers may use inputs to improve services according to their policies. Keep confidential material out of the public service. Public YouTube source readings are shared in a 24-hour Redis cache; user-supplied transcripts and completed chapters are not. Saved chapters stay in the browser until the visitor exports them; PDF requests send the chosen chapter to NanT's Vercel function for rendering, without a model call. There is no analytics or account database in this implementation.

## Local hosted preview

```text
npm ci
npm run build
node --env-file-if-exists=.env scripts/preview-web.js
```

Open `http://127.0.0.1:4318`. Without provider keys and a quota database, the site honestly shows a preview state; the original authored sample, Markdown/source downloads and PDF rendering work. Use `npm start` for the existing local-model app on port 4317.

## Verification

Run `npm test` and `npm run check`. Tests cover clipped input, chronological assembly, missing parts, invalid IDs, missing/unreadable code, conservative source recovery, secret-free config responses, strict free routing, persistent quota reservation/failure and real PDF bytes. Provider responses are mocked in these tests; no model accuracy percentage is inferred.

References: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [function limits](https://vercel.com/docs/functions/limitations), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini video input](https://ai.google.dev/gemini-api/docs/video-understanding), [OpenRouter free models](https://openrouter.ai/docs/guides/routing/model-variants/free), [Upstash Free](https://upstash.com/pricing/redis).

## Deployment check — 22 October 2026

The public site at https://nant-sepia.vercel.app returned HTTP 200 without authentication. Its shared Gemini connection is configured, and the claimed Free Redis database passed a live connection check. Visitors do not need keys. Deployments currently use the Vercel CLI; pushing to GitHub does not by itself confirm a new production deployment.

A real Karpathy chapter, **08:00–13:00** of `kCc8FmEb1nY`, completed through the public API: four bounded source reads, writing, chronological assembly and PDF export. Its final draft retained all **19 acquired speech passages (858 source words)** and **10 typed visual/code records**. Checks found the GPT-2 example `[71, 4178, 612]`, vocabulary `50257`, and `torch.tensor`. The live renderer returned a six-page Textbook lesson PDF; all pages were rendered and visually inspected. This establishes a working vertical slice, not independent proof that every spoken or visual detail in the original video was acquired.

In that run, 15 passages retained acquired source wording after rewrite validation failed. The subsequent writer change constrains the response structure and recovers individual failed passages while keeping successful rewrites; this recovery behavior has regression coverage, but was not measured in another live conversion after the daily test allowance was used. The chapter remains a reviewable draft, with machine-read source/code and unmeasured semantic fidelity. A previous low-resolution trial misread printed token IDs and was rejected; high-resolution reading is now the default. Older-model account restrictions and busy-model failures were also reproduced and handled explicitly.

All **125 automated tests** passed, including source validation, cue-level recovery, batched writing, cancellation, short-throttle recovery, quota enforcement and PDF bytes. These tests use mocked model responses; the live chapter is separate evidence. The authored sample also exported successfully. Mobile layout was checked at 390 px with no horizontal overflow. No accuracy percentage is asserted.

## Free fallback release check — 25 October 2026

The live configuration reports both Gemini and OpenRouter connected, with the daily per-connection cap disabled (`visitor: 0`). The shared 80-attempt counter and six-attempt short-term protection remain. OpenRouter authentication and its account-specific free-model allowance were checked without exposing the credential. The key is stored server-side, outside source control.

A real unfamiliar chapter from freeCodeCamp's JavaScript course (`PkZNo7MFNFg`, **03:00–08:00**) completed through the public service: **21 acquired speech passages, 794 source words, 12 visual/code records**, no source-wording recovery, and a six-page Textbook PDF. A repeated exact source window returned `reused: true` with unchanged speech. The browser flow also completed using the shared source cache. The first run exposed a visual timestamp on the final supplied context frame; the validator now preserves records inside the actual -2/+3-second source context without shifting their timestamps. Saved parts survived the failure and were resumed. PDF inspection also led to keeping headings with their following paragraph or code block.

A controlled fault-injection test simulated a Gemini writing quota error and called the **real free OpenRouter endpoint**. All six supplied passages were rewritten in order with zero source recovery. Its initial response-format issue was corrected with required JSON Schema output. This is evidence for real OpenRouter writing plus the simulated failover trigger; it is not a claim that a genuine Gemini daily quota was exhausted during that test.

The equivalent video test attempted the real free Gemini 3.8 fallback after a simulated primary quota failure, but the fallback provider was unavailable. Source failover is covered by deterministic tests, while live alternative-video availability remains unverified. OpenRouter is **not** advertised as a clipped YouTube reader. If all compatible video readers are unavailable, new source acquisition still pauses honestly. No paid service or account was enabled.

All **137 regression tests** pass. They cover provider selection, separate fallback reservations, persistent cooldowns, correct Pacific/UTC resets, cancellation, source reuse, malformed writing recovery and source-only PDF export. `npm run test:hosted -- --url YOUTUBE_URL --start SECONDS --duration 300` repeats the live flow and saves checkpoints privately. The result is suitable for a limited public beta; no complete-video fidelity guarantee or accuracy percentage has been established.
