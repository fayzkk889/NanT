# NanT 0.5 — local video-to-written-course MVP

Paste a YouTube lecture URL, choose a chapter or the full video, and create a written edition with captured screens, source timestamps, Markdown and a styled PDF. You can also upload a recording for local speech transcription. The application code is MIT licensed; creator material and dependencies retain their own notices.

## Run this workspace

Start Ollama, then run this in the NanT directory:

```powershell
npm.cmd start
```

Open http://127.0.0.1:4317. This workspace already has npm dependencies, FFmpeg, local source tools, the Whisper small.en speech model and the downloaded Qwen3.5 9B writing model. No model API key is needed. Public source requests need an internet connection; screen reading, speech transcription, writing and review run on this device.

On this computer, Ollama runs inside Ubuntu on WSL. The local `.env` sets `OLLAMA_WSL_DISTRO=Ubuntu`, so starting this app keeps that existing runtime awake until the app closes. This does not install or change the Ollama service. Leave this setting blank on a native Ollama installation.

## Fresh checkout

Use Node.js 22+ and Python 3.12. Install npm dependencies and the optional local media tools:

```powershell
npm.cmd ci
npm.cmd run setup:media
npm.cmd run setup:sources
npm.cmd start
```

Set `PYTHON` to a Python executable if it is not on PATH. `setup:media` installs a pinned FFmpeg wheel in `.tools`; `setup:sources` installs the pinned Python adapters, local OCR and approximately 484 MB of Whisper small.en model weights. The writing model must already be installed in Ollama. Nothing sends tutorial material to a hosted model. Set `ASR_MODEL=base.en` before setup and in the app environment for the smaller, less accurate speech model.

On non-Windows systems, set `FFMPEG_PATH` to the installed FFmpeg executable. Optional settings are documented in `.env.example`; do not share `.env`.

## Convert a YouTube lecture

Choose **YouTube video**, paste the URL and select one 5-, 8- or 10-minute chapter. Choose its start timestamp, select **Local model** and start writing. For a long course, continue through the timestamped windows chapter by chapter; this is the recommended release workflow. **The full video, in chapters** remains experimental. For the representative Karpathy tokenizer chapter, use https://youtu.be/kCc8FmEb1nY with start **08:00**, window **5 minutes**.

The adapter first looks for supported publisher captions/downloads. Otherwise it reads public YouTube captions through an unofficial local connector and downloads ordinary public audio/video streams with yt-dlp and FFmpeg. Available local Whisper transcription is preferred even when YouTube marks a caption track as manually supplied: that flag does not guarantee correct programming terms. The original caption track remains cached on this device. Separate audio/video streams are merged locally. If captions are unavailable but a recording is recovered, Whisper transcribes the chosen window locally. Public caption/download availability can change; login-only, age-restricted and live sources are unsupported. No cookies, proxy services, paid model fallback or authentication bypass is configured.

The creator-editing token is optional for the older official Data API caption route. It is not required by the new public source path. Personal study imports have no permission checkbox or backend approval gate.

## Convert a recording

Choose **Audio or video recording**, select an MP4, MKV, MOV, WebM, MP3, M4A, WAV, OGG or FLAC file under 1 GB, and choose the chapter window. The file is streamed to local storage; the app accepts an upload ID instead of arbitrary server filesystem paths. Audio-only sources cannot preserve unspoken code or diagrams. English speech is currently supported. Recognition can miss quiet speech and misread names, numbers and code terms.

**Transcript of my recording** remains available for timestamped text imports. It does not require a fake YouTube link. Exported evidence JSON reopens without regeneration; the source recording must still exist locally to create more windows from an uploaded source.

## What the pipeline does

1. Retrieve captions and check public YouTube audio with local speech recognition, or transcribe an uploaded recording locally. A small programming vocabulary prompt guides recognition; it does not supply lesson facts. Cached speech is versioned with the model and transcription settings.
2. Group cues into whole spoken sentences and preserve them in chronological chapter windows. Interior sentence times are proportional estimates within the original recognition cue and are flagged in review; captured-frame times are measured separately. Final short windows stop at the known recording end.
3. Capture periodic screens and extra frames near speech about code and output.
4. Read clear printed text with local OCR; use local vision for diagrams, unclear frames or OCR failure. All original captured images remain available.
5. Align near-matching machine-speech codec input spellings with repeated decoded screen observations before writing and review. Keep the original transcript and a correction trail. Bind a displayed n_vocab count separately from the maximum integer ID. Write one teaching passage at a time. The writer uses the spoken source and repeated nearby screen spellings for programming identifiers. Exact repeated screen values are inserted in example boxes rather than being retyped by the model, while original screens stay alongside the lesson. This prevents background README text and prior code from becoming new teaching. Invalid, repeated or internally inconsistent character-encoding examples get one retry, then keep their source wording. A repair failure cannot discard valid writing from other passages.
6. Compare the written content against captions, screen observations and selected original frames. Criticism must quote actual source/draft text, then pass a separate passage-level audit before it can replace prose. Unconfirmed or unavailable audits do not authorize source replacement or a review pass. Repairs edit the existing passage, preserving its other teaching. Retain original explanations only where supported content checks still fail. All-source recovery is labeled as a source edition, never a successful written tutorial.
7. Export one Markdown/PDF/source bundle with attribution and timestamp links.

The local conversion queue runs one pipeline at a time and permits one waiting job, avoiding concurrent inference exhausting memory. Stop cancels active or queued work. Progress polling sends compact status rather than repeatedly transferring saved chapter images. Full-video runs save completed chapters as checkpoints; Retry resumes matching completed work. Changed source text or a pipeline revision invalidates stale cached work. Exported books store each chapter image once; their combined timeline is reconstructed when reopened.

## Reading and PDF styles

Choose **Full lesson** for independent reading, or **Study notes** for a more compact layout alongside the video. Both retain the complete written explanations and code steps: Study notes is a layout change, not a shorter summary. Clean exports contain readable code blocks and outputs, with no video screenshots or raw transcript appendix. Section timestamps are off by default; the original lesson still has one link on the opening page. Long raw data displays are explicitly marked as excerpts, with their producing code retained; unreadable character listings can be reproduced by running the shown code.

The first clean export uses the local vision model to transcribe relevant captured code and figures into text, then caches those readings on this device. It can take a few minutes. No model key or hosted service is used. If an essential screen cannot be read, export reports that problem instead of silently deleting its code. Transcribed code and outputs can still contain recognition errors; review important examples before relying on them. Imported tutorial code is never executed.

Choose **Source review** to keep the original screenshot-heavy edition: detailed timestamps, captured screens, raw speech, and review notes. This export remains available without additional model calls. The original evidence JSON and in-app Source & review view always retain source records. Textbook, Code Companion and Print Classic change typography within each edition.

Some prose retains original source wording when rewriting is unreliable. These passages are labeled. Source-ID coverage is a structural check and is not a fidelity score. OCR punctuation/indentation, local vision text, speech recognition and model prose can be wrong. Compare important code against retained images. A completed draft still needs review before being treated as a faithful independent tutorial.

## Limits and storage

Limits include 1 GB per uploaded/public video file, 96 book chapters, 2 MB/20,000 transcript cues, 2,000 cues/100,000 characters per chapter, 1,200 visual records, bounded frame-image sizes, and a 200 MB saved-book import. Publisher-linked MIT downloads retain the earlier 220 MB bound. Very large media or evidence fails explicitly rather than silently dropping content.

Files, source caches, captured frames, local speech transcripts and jobs are stored in `.local-data/`. Installed tools and model weights live in `.tools/`. No public course publishing or telemetry service is included. These folders, `.env`, installed dependencies and generated source books are excluded from the source archive. Imported code is displayed as data and is never executed.

## Open-source use

See LICENSE, THIRD-PARTY-NOTICES.md and CONTRIBUTING.md. The MIT license covers this application's original software. It does not relicense tutorial narration, creator code, recordings, model weights or fonts. MIT OpenCourseWare-derived outputs keep their CC BY-NC-SA attribution and restrictions. Keep source attribution when exporting or sharing your notes.

## Checks

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run acceptance
```

The regression suite includes mocks, fixtures and local HTTP tests. The acceptance command uses real public course URLs and local model calls; each chapter has a 30-minute processing limit, with queue waiting measured separately and failures remain failures. A reported successful draft is not independent semantic verification. The 0.3/0.4 reports are retained as history; USER-TEST-REPORT.md records the current observed results.
