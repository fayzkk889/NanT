# NanT — not an average notetaker

[Live web preview](https://nant-sepia.vercel.app) · [Free hosting setup](DEPLOYMENT.md)

An open-source tool for turning programming tutorial videos into written course chapters with ordered explanations, code screens, timestamp links and styled PDFs.

NanT now also includes a Vercel web edition with an original notebook-inspired identity. Hosted conversion uses the project's shared free-tier model connection once configured; visitors never supply API keys. [Hosting and free-tier setup](DEPLOYMENT.md).

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

A complete draft is reviewable output, not independently certified fidelity. Important code and concepts must be checked against the retained source images. See [current acceptance results](USER-TEST-REPORT.md); older reports are retained as history.

The hosted path is tested separately with mocked provider responses. It does not inherit the local model's real-video acceptance results. Live cloud conversion must be tested with the operator's configured free-tier key before it is advertised as available.
