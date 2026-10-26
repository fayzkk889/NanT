# NanT — not an average notetaker

[Live app (beta)](https://nant.live/) · [Product Hunt launch](https://www.producthunt.com/products/nant?launch=nant) · [Free hosting setup](DEPLOYMENT.md)

An open-source tool for turning programming tutorial videos into written course chapters with ordered explanations, code screens, timestamp links and styled PDFs.

NanT also includes a live Vercel web edition with an original notebook-inspired identity. Hosted conversion uses the project's shared free-tier Gemini connection; visitors never supply API keys. Start with one 5–10-minute chapter, then download a styled PDF. Shared daily allowances apply. [Hosting and free-tier setup](DEPLOYMENT.md).

## Start

Run `npm ci` and `npm start` with Node.js 22+. Start a downloaded model in Ollama. Optional public-source, local speech and screen tools are installed with `npm run setup:media` and `npm run setup:sources` using Python 3.12.

Open http://127.0.0.1:4317. Paste a YouTube URL or choose **Audio or video recording**. Start with one 5–10 minute chapter and choose its start timestamp. For long courses, continue chapter by chapter. Full-video conversion is experimental. No cloud model key is required.

[Setup and usage](START-HERE.md) · [Contributing](CONTRIBUTING.md) · [MIT software license](LICENSE) · [Third-party notices](THIRD-PARTY-NOTICES.md)

## Current scope

- Public YouTube captions and video/audio retrieval; supported MIT publisher sources.
- Uploaded recordings with local English Whisper transcription.
- Periodic and speech-linked screen captures, local OCR and vision.
- Passage-level writing from speech, immutable repeated screen examples, separate visual review, repair and explicit source recovery.
- Full-video chapter assembly, checkpoints, saved work and Markdown/JSON/PDF exports.
- Textbook, Code Companion and Print Classic PDF styles.
- Clean Full lesson and compact Study notes exports, with optional section timestamps. Original screens and raw source are available separately in Source review.

The source archive excludes credentials, recordings, private jobs, model weights and generated course books. Imported code is never executed. The software license does not change the licenses of course material, creator code, fonts, dependencies or models.

## Validation

`npm test` runs fixture, mock and local HTTP regression tests. `npm run check` checks JavaScript syntax. `npm run acceptance` runs live conversions of unfamiliar course URLs against the running app. Live source availability and local hardware affect conversion time.

`npm run test:hosted -- --url https://youtu.be/kCc8FmEb1nY --start 480 --duration 300` checks the public web app with real providers, saved checkpoints, cross-request source reuse and PDF export. It uses shared free capacity and runs only when explicitly invoked. Artifacts stay in ignored `.local-data/hosted-acceptance`. It establishes acquired-source coverage and a working conversion flow, not independent semantic accuracy.

The hosted service tries compatible free Gemini video readers, then Gemini/OpenRouter for writing. Public video source reads are reused for 24 hours. The daily per-connection cap is disabled by default; shared provider capacity, a global service counter and short-term protection still apply. No paid fallback is selected.

A complete draft is reviewable output, not independently certified fidelity. Important code and concepts must be checked against the original lesson and retained source records. See [current release checks](RELEASE-CHECK-2026-10-26.md); older reports are retained as history.

The hosted path is tested separately: a real five-minute Karpathy chapter completed through the public service and exported as a six-page PDF on 22 October 2026. It retained 19 acquired speech passages and 10 typed visual records; 15 passages used source wording after rewrite validation failed. Source completeness and semantic accuracy remain unmeasured. See [live deployment checks and limitations](DEPLOYMENT.md#deployment-check--22-october-2026). Hosted results do not inherit the local model's acceptance results.

The 26 October reader fixes use 30-second clips, fixed acquisition cells, versioned source reuse, coherent paragraph writing and a tested free Flash-Lite video fallback. The previously omitted Python explanation is recovered in the real-source regression. [Tests, exports and remaining limits](RELEASE-CHECK-2026-10-26.md).
