# Course Zero 0.5 — local MVP release checks

For the latest hosted release decision, see [the 25 October user acceptance test](USER-POV-REPORT.md): **release is on hold after an independently observed source omission**. The older local checks below do not establish hosted source completeness.

21 October 2026. This is a working local MVP for reviewable written chapters and styled PDFs. The recommended release workflow is one 5–10 minute chapter at a chosen timestamp, including for long courses. Full-video conversion remains experimental. Website redesign, hosting and deployment are outside this release. No cloud model API key is used.

## What completed

Public source acquisition now works for the tested URLs. All three unfamiliar courses completed actual URL-to-chapter conversions with local speech recognition, writing, captured screens and timestamped Markdown. None of these runs required a passage-level source recovery.

| Real course, first five minutes | Teaching passages retained | Captured screens | Source-recovery passages |
| --- | --- | --- | --- |
| Mosh JavaScript, W6NZfCO5SIk | 11/11 | 24 | 0 |
| freeCodeCamp Python, eWRfhZUzrAc | 10/10 | 23 | 0 |
| Mosh ES6, NCwa_xi0Uuc | 11/11 | 24 | 0 |

These are structural completion results, not accuracy percentages. The automatic content reviewer did not establish a pass: its remaining findings lacked reliable source quotations. Outputs retain an explicit review warning.

Manual inspection found and fixed corrupted programming names, misheard string delimiters, and misheard declaration keywords/underscore-separated identifiers. The final JavaScript and Python fixes were checked on the actual affected source passages using the installed local writing model: the output now says `single quote` and `player_choice`. Those were targeted real-model reruns, not another full three-course cohort. The ES6 full chapter correctly preserves `this`, function scope for `var`, block scope for `let`, and reassignment behavior for `const`.

The caption metadata flag is no longer trusted as a quality guarantee. Local audio is checked even when YouTube marks a track as manually supplied. Small.en replaces base.en as the default local speech model. Corrections supported by source screens retain an audit trail and never overwrite the exported raw transcript. Cached conversions also distinguish speech/writing model settings.

## Representative Karpathy chapter

The accepted 08:00–13:00 tokenizer chapter has 10/10 teaching passages, 26 actual captured screens and no source-recovery passages. Sentence overlap is retained from approximately 07:50–13:14.

Manual checks covered set/list/sort vocabulary construction; 65 characters; the exact `hii there` input and its nine character IDs; the GPT-2 example's three IDs; 50,257 vocabulary entries versus maximum ID 50,256; tokenizer trade-offs; and encoding the full dataset into a PyTorch tensor before displaying its first 1,000 elements. A separate reproduction checked the character vocabulary and round trip against the creator's Tiny Shakespeare dataset. The accepted artifact predates the final speech-model upgrade; its manually checked prose was preserved.

The three exported styles were rendered and visually inspected. Each is 17 pages with all 26 source images and 48 timestamp links. Actual browser downloads of Textbook, Code Companion and Print Classic were also confirmed to contain those pages, images and links. Full-size source-screen viewing works.

## Functional and regression checks

113/113 regression checks pass, including isolated real HTTP tests. They cover source adapters/fallbacks, ordering, content guards, review auditing, cancellation/queue limits, restart recovery, full-book checkpoints, short final chapters, 96-chapter bundles, export/reopening, PDFs and local-access restrictions. Fixtures and mocked model responses are used where appropriate; these tests do not certify semantic fidelity.

Browser checks cover empty input, a rejected third simultaneous request, retaining the previous readable/exportable chapter after a rejected request, real recording upload/transcription, saved chapter restoration, full-size screens and all three PDF downloads. A clean extracted source archive installs its pinned JavaScript dependencies and runs the regression suite; local model weights and media tools are separate installations.

## Clean reading exports

Full lesson and Study notes now export without video screenshots, raw transcript appendices, or repeated source timestamps. The accepted Karpathy chapter is 7 pages as a Full lesson and 6 pages as Study notes, versus the earlier 17-page source-rich edition. Both clean PDFs contain zero images and one original-lesson link. Text extraction checks confirm that all existing explanations survive unchanged; all pages were rendered and visually inspected. Both formats downloaded successfully through the actual browser UI.

Relevant on-screen code is transcribed with the installed local vision model and cached. The dataset-download command is retained even though a later screen scrolls past it. Repeated encoder observations bind the exact input/vector pair. Typed Python code passes syntax parsing; imported tutorial code is never executed. Long raw-data displays are clearly marked excerpts, and an unreadable character listing is reproducible with its retained code. The original observations stay in the source bundle. These are fallible machine readings, not certified code.

Study notes changes density, not the teaching content. Optional section timestamp links can be enabled for either clean format. Source review retains the earlier screenshots, timestamps, raw source and detailed warnings and is available without additional inference. An unreadable essential screen produces an explicit export failure rather than being silently removed. Reopened books must retain readable materials from every chapter; preparation of only one chapter cannot mark a whole book complete.

## Accuracy and completeness

A subjective estimate for the inspected short chapters is around 90% faithful. This is not a measured benchmark or a claim about arbitrary videos or entire courses. There is no defensible measured accuracy percentage yet.

A missing teaching step is a failure, regardless of an average accuracy estimate. Retaining every transcript passage is necessary but does not prove every idea survived the rewrite. Full raw source text and captured images remain available for comparison. Extra explanatory material should be distinguished from source teaching; the current writer is instructed to stay close to the source.

Known limitations include occasional identifier formatting (a spoken function name can appear with spaces), transcription errors, fallible model review, and screenshots sampled every 15 seconds plus speech-linked captures. Brief intermediate screens or quiet speech can be missed. Important code should be compared with retained original images. Automatic completeness certification is not implemented.

The complete two-hour Karpathy book has not been generated and manually checked. Full-video assembly/checkpoint/reopening behavior is regression-tested; full-course semantic completeness remains unproven. Source-only fallbacks are labeled and are not represented as successful written tutorials. Imported code is displayed as data and never executed.

## Run and package

Run `npm.cmd start` in this directory and open http://127.0.0.1:4317. For the checked Karpathy window, paste https://youtu.be/kCc8FmEb1nY, choose start 08:00 and a five-minute window. Setup instructions are in START-HERE.md.

Test runtime: Node.js 22, Python 3.12 adapters, FFmpeg, local Whisper CPU transcription, local OCR, and Qwen3.5 9B through Ollama in Ubuntu WSL. Public source retrieval requires internet access; source inference, writing and review stay local.

The MIT source archive excludes `.env`, local recordings/jobs, generated course books, installed dependencies and model weights. Creator content and third-party components retain their own licenses and attribution. Release here means a local software package, not an externally published website.
