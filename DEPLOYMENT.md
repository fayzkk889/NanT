# NanT on Vercel

The public site is a static web app plus one stateless Node function. The browser runs a 5–10-minute chapter as resumable 90-second source-reading and writing requests. Completed steps and chapters are saved in IndexedDB on the visitor's device. The existing `npm start` desktop app still uses local Ollama, Whisper and original video frames.

## Free launch setup

1. Import this repository into a **Vercel Hobby** project. `vercel.json` sets the build command (`npm run build`), output directory (`dist`) and function duration. Hobby is for personal, noncommercial projects. Review the hosting plan before introducing paid/commercial use.
2. Create a Google AI Studio API key in a project **without billing enabled**. Add `GEMINI_API_KEY` as a **server-side Secret** in Vercel, plus `GEMINI_FREE_TIER_CONFIRMED=true`. The default model is `gemini-2.5-flash`; only it and `gemini-2.5-flash-lite` are accepted. The confirmation is an operator assertion: NanT cannot inspect Google's billing status, and those same models have paid tiers on billed projects.
3. Create or claim an **Upstash Redis Free** database. Set its `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as server-side Secrets. Temporary unclaimed databases expire; claim one before a durable public launch. Only hashed connection identifiers and quota counts are stored there, with two-day expiry. Course content and API keys are not stored in Redis.
4. Optionally add `OPENROUTER_API_KEY` as a server-side Secret to use OpenRouter for writing. All requests use `openrouter/free` with zero-price routing. OpenRouter alone cannot read YouTube URLs in this implementation; Gemini is still required for video source acquisition. There is no paid fallback.
5. Deploy and test one real public chapter end to end. Check the original speech/code against the written result. A successful sample or mocked model test does not establish real-source fidelity.

Do not prefix any secret with a browser/public environment prefix. Do not commit `.env`, `.env.local`, `.vercel`, `.local-data`, `.tools` or generated course material. The static builder uses an explicit public-file allowlist; `.vercelignore` excludes recordings and local runtime state from uploads.

## Limits and costs

`CLOUD_DAILY_REQUESTS` defaults to **80 provider requests across everyone**, and `CLOUD_VISITOR_DAILY_REQUESTS` to **20 per connection**. A chapter makes multiple requests (e.g. a 5-minute video normally uses eight: four source reads and four writes). The limits count requests, not chapters. An atomic Redis script also enforces six requests per connection per minute. Failed model calls count because they can still use provider capacity. Limits reset at 00:00 UTC; the model provider can impose a lower quota first. If quota storage fails, shared generation stops rather than bypassing the limit. Network-based limits may be shared by people on the same campus/Wi-Fi.

The app does not buy credits, enable billing, select paid fallbacks, or upgrade hosting/database plans. Free allowances are finite and availability is not guaranteed. Setting a model key on a billed Gemini project can still incur charges; application-level counters are a usage cap, not a provider billing switch.

Source bundles on the web app are limited to 1.5 MB. Raw recording uploads, local speech inference, original video-frame capture and whole-video background processing remain available in the desktop version. The hosted edition reads public YouTube videos through Gemini, or accepts supplied timestamped transcripts and visual records. It preserves acquired cues and separate code states but cannot prove all video content was acquired. Unreadable required code stops a source read. Independent semantic verification is not yet implemented on this path.

## Privacy

The public app sends the selected video URL to Google for clipped video understanding. Extracted/supplied text and visual records go to Google, or OpenRouter when configured, for writing. Free-tier providers may use inputs to improve services according to their policies. Keep confidential material out of the public service. Saved chapters stay in the browser until the visitor exports them; PDF requests send the chosen chapter to NanT's Vercel function for rendering, without a model call. There is no analytics or account database in this implementation.

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

The public preview at https://nant-sepia.vercel.app returned HTTP 200 for the page, logo, and config without authentication. The authored eight-minute sample returned all 8 acquired source IDs; the live Vercel function generated a real five-page Study notes PDF with code. Mobile layout was checked at 390 px with no horizontal overflow. All 122 automated tests passed. Persistent quota storage was tested against the Free database. The shared model key had not yet been configured, so real YouTube conversion correctly returned HTTP 503 and remained unverified. This is a live preview, not a claim that hosted conversion is production-ready.
