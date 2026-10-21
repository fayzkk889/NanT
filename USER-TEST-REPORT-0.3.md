# Course Zero: end-to-end acceptance report

Test date: 17 October 2026. Build: 0.3.0. Tester: Codex acting through the browser and HTTP interface; these were simulated user journeys, not a recruited human usability study.

## Verdict

**Not ready for the main product promise.** None of three unfamiliar public course URLs produced a written chapter. The app stopped at transcript acquisition. A running local model does not supply missing video content. The original Karpathy conversion and full-course conversion remain incomplete.

The supplied-source workflow does work: import timestamped material and screen records, generate locally, read a chapter, recover it after refresh/restart, choose a layout, and download a PDF. That is a narrower product than “paste a long tutorial link and receive a faithful written course.”

## Real-course acceptance

These were selected unfamiliar examples, not a statistically random sample. Each URL was submitted through the app's real HTTP flow and retested after fixes. A beginner's browser journey was also tested. No third-party transcript was invented or replaced with an unrelated fixture.

| Course | URL | Observed outcome |
| --- | --- | --- |
| Programming with Mosh: JavaScript beginners | https://www.youtube.com/watch?v=W6NZfCO5SIk | Needs transcript; no chapter |
| freeCodeCamp: Python for Beginners | https://www.youtube.com/watch?v=eWRfhZUzrAc | Needs transcript; no chapter |
| Programming with Mosh: ES6 tutorial | https://www.youtube.com/watch?v=NCwa_xi0Uuc | Needs transcript; no chapter |

**Result: 0/3 URL-to-chapter successes.** The official caption adapter reported that its editing-permission OAuth token was absent. This result establishes a limitation of this implementation and configuration, not a claim that these videos have no captions. A final browser visit could open the Mosh JavaScript page; the browser's supported transcript export returned “No transcript is available for this YouTube video.” Earlier CAPTCHA observations should not be treated as a permanent description of the current browser session.

No access restrictions were bypassed. Media was not downloaded, hidden caption endpoints were not scraped, and browser cookies were not copied into the app.

## Live local-model tests

All calls used the already available `qwen3.5-4b-64k:latest` through local Ollama. No cloud key, paid model, or automatic model download was used. These sources were authored test lessons with simulated times, **not actual recorded third-party courses**.

| Test | Outcome and checks |
| --- | --- |
| JavaScript reducer: string initializer, failed output, numeric correction, empty input | Live model output; 6/6 source IDs in order. All supplied code/output states retained. An injected instruction inside a source comment remained data. Manual review found an unsupported callback argument-count assertion in the first output. The prompt was tightened; a fresh local retest removed that assertion. This does not establish that hallucinations are solved. |
| Python: assignment, shallow copy, shared nested list, deep copy | Live model output; 6/6 IDs in order. The intermediate failure, diagram transcription, input reset, limitation, and final code survived the inspected output. |
| SQL: COUNT(*), COUNT(column), NULL, WHERE/HAVING | Live model output; 6/6 IDs in order. Supplied query/output progression retained. The prose closely copied an already well-written source, so this is weak evidence of spoken-to-written quality. |
| Spoken-style sorting test, imported through the browser | Imported rough/disfluent text and five screen records, generated locally, read the result, refreshed, recovered from history after an actual server restart, and downloaded Print Classic from a 390×844 viewport. Six teaching segments, three code states, and two output records retained. No horizontal overflow was observed; no browser warning/error logs were captured. This was a simulated spoken transcript, not an audio transcription test. |

Manual review of the sorting output confirmed the important progression: `sort()` returns `None` and mutates the input; this fails the original-order requirement; reset the input; use `sorted()`; test both lists. The prose still contains narration about “the instructor” and editorial instructions from the source. It is usable as a reviewed prototype, but it is not yet the polished book experience requested.

## Failures fixed and retested

| User action | Failure found | Change and verification |
| --- | --- | --- |
| Paste a URL without supplying source material | Permission checkbox blocked even a source lookup | Confirmation now applies to supplied material; URL-only requests reach the honest source-needed state. |
| Paste a normal copied timestamp transcript | Parser rejected a common timestamp/text format | Added parser support; inferred cue ends are disclosed. |
| Paste a short or scheme-less link with a time | Valid-looking input was rejected or its time ignored | Canonicalization and timestamp handling added; parsing tests and browser source-switch test pass. |
| Switch from one video to another | Previous captions/evidence could stay attached | Clear bound material, permission, and old output; browser test confirmed clearing and 06:30 selection. |
| Import a different lesson after selecting a later start | Previous start selected the wrong/empty window | Imports reset or read the supplied start/window, replace evidence, and require fresh permission. Browser retest filled local title, 00:00, five minutes, and unchecked permission. |
| Use a transcript from a personal recording | Required a fake YouTube URL | Added local-recording transcript mode and truthful local time labels. No fabricated video links. |
| Double-submit or retry | Duplicate work or no explicit recovery action | Reuse identical active/successful jobs; explicit Retry forces a new run. Regression coverage. |
| Stop writing | No cancellation; later partial output could be accepted | Abort active work, discard its output, and offer Retry. Live browser retest passed. |
| Cancel on Windows | Simultaneous saves could produce a storage warning | Serialize per-job writes with bounded busy-file retries. Live cancellation retest showed a stopped message without that warning. |
| Refresh, restart, or reopen an exported chapter | Results or PDF endpoints disappeared | Local JSON persistence, recent history, source restoration, validated evidence-JSON reopening. Actual browser recovery plus automated restart/PDF tests. |
| Poll “ready” and immediately restart | Rarely reopened as interrupted because saving lagged | Reads now wait for pending persistence. The previously failing restart case passed three consecutive targeted reruns after the fix. |
| Use dense captions | Small cue limit and oversized single local request | Raised bounded chapter cue limit; sequential generation parts preserve ordered IDs and show progress. Dense/multipart tests use mocked model responses; long live multipart quality is still unproven. |
| Export a very long code line | Export failed | Explicit visual wrapping with original source preserved in JSON. PDF text and rendering checks pass. |
| Export on a phone | Export controls were below the entire manuscript | Added layout/download controls near the chapter opening; actual phone-sized download passed. |

## Verification evidence

- Latest full regression run: **33 passed, 0 failed**. Syntax checks passed. Two earlier intermittent restart failures were reproduced and fixed; their existence is not hidden by the final pass count.
- Three original technical lessons were generated live locally, plus a JavaScript retest and the browser sorting run. These are separate from mock adapter tests and from the three failed real-course requests.
- Ten PDF cases were retypeset: three lessons × three styles, plus an extreme code line. All source IDs and supplied evidence text were found in extracted text. All 56 pages were rendered to images and inspected as contact sheets; the wide-code page was also inspected at larger size. No clipping or overlap was observed at those inspected scales. This is not a multilingual typography certification.
- Saved-JSON malformed IDs, missing prose, request bounds, local access restrictions, source HTML rendering, no silent cloud fallback, queue bounds, and cancellation paths were exercised. This was not an exhaustive security audit.
- The browser screenshot `course-zero-tested.jpg` shows the actual completed sorting chapter and model/review labels.

The source archive includes `test-results/` with the final regression log, real-URL acceptance log, local-run summaries, and PDF text-check results. Detailed scratch runs remain in this workspace's `work/` directory. Private saved-job storage and installed dependencies are excluded from the archive.

## Still required before accepting the product

1. A permitted, practical way to obtain source transcripts/media for normal users. Import is useful but does not fulfill URL-only conversion. An LLM API key does not fix this.
2. Actual video/audio ingestion and transcription where authorized, plus frame extraction, screen reading, and code-state reconstruction. Current “visuals” are supplied records and suggested check times.
3. Full-course execution with chapter boundaries, saved progress, continuity, and a combined book export. Current generation handles one 5–10 minute window.
4. Content-level evaluation against real lessons: every explanation, analogy, correction, shape, visual state, and terminal detail. Source-ID coverage and a compression threshold cannot prove fidelity.
5. Better rewriting of spoken material and editorial review. The local model still can add unsupported details or retain source meta-instructions as prose. No independent learner study has been run.

The acceptance gate remains **failed** until real permitted course material can complete the intended journey and its output has been checked against the lesson. The working imported-source flow and passing regression tests are not substitutes for that gate.

## Reproduce and use

From `outputs/course-zero`, run `npm.cmd start`, then open http://127.0.0.1:4317. Dependencies are already installed in this workspace; an extracted archive first needs `npm.cmd ci` and Node.js 22+.

For the reproducible browser test, open Transcript & screen evidence, import `test/fixtures/oral-sorting.json`, confirm permission for this original test material, and select Write this chapter with Local model. Review the result and export any of the three PDF styles. Keep Ollama running. No API key is needed for that path.

Run `npm.cmd test` and `npm.cmd run check` for regressions. With the server running, `npm.cmd run acceptance` reproduces the three course checks and is expected to exit nonzero while source acquisition fails. Add `-- --local` to additionally run the original spoken-style fixture against the actual local model.

The temporary test server is stopped after testing; saved chapters remain on disk and return when the app is started again.
