> Historical 0.4 report. The current local source pipeline is documented in START-HERE.md and USER-TEST-REPORT.md.

# Course Zero acceptance update — 20 October 2026

## Verdict

The original promise remains unmet for arbitrary YouTube courses and the Karpathy target. A real local-only five-minute publisher lecture chapter now works from a URL, with local screen reading, source-preserving writing, timestamp links and PDF export. This is progress on the required pipeline, not proof of general or full-course acceptance.

## Clarification: private study does not require an app permission checkbox

The private study flow no longer asks users to certify permission before processing imported transcript/screen records. The backend gate was removed as well. The 46-test suite passes, including transcript import without that flag, and a browser test completed private notes without an approval prompt. Switching source types now resets a stale chapter start time.

Earlier references to an editing-access token describe the implemented YouTube Data API connector, not a universal condition for taking notes. Public YouTube transcript ingestion and local audio transcription are unfinished integrations. Removing the permission gate does not fix those integrations or the model's fidelity failures. These are engineering gaps, not missing approval from the user.

## Actual user tests

| Test | Observed result | What it proves |
| --- | --- | --- |
| Fresh MIT lecture URL, 10:00–15:00, local model, empty transcript/evidence fields | Ready; 10/10 source groups; 23 measured frames; PDF and source bundle downloaded through the browser | A real permitted source can go through the entire local pipeline |
| Final corrected bundle reopened after server restart | Verified in the browser without regeneration | Saved work and portable chapter imports work |
| Textbook, Code Companion, Print Classic export | 16, 16, 15 pages; all 23 captured images and all source/frame IDs retained; teaching screen text retained | Export preserves the selected material in each style |
| Mosh JavaScript (`W6NZfCO5SIk`) URL only | Needs source material | Failure: source acquisition remains unavailable |
| freeCodeCamp Python (`eWRfhZUzrAc`) URL only | Needs source material | Failure: source acquisition remains unavailable |
| Mosh ES6 (`NCwa_xi0Uuc`) URL only | Needs source material | Failure: source acquisition remains unavailable |
| Karpathy GPT (`kCc8FmEb1nY`) | No permitted accessible source in this workspace | Still unmet; no completed Karpathy chapter or book |
| Full-video assembly, chapter checkpoints/resume and reopening | Automated fixture tests pass | Assembly behavior only; no real full-course acceptance run |
| Regression suite | 46/46 tests pass; syntax checks pass | Includes mocks and local HTTP tests; not a fidelity certification |

The MIT input is the publisher's [Lecture 12: Searching and Sorting](https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-12-searching-and-sorting/). Captions and the downloadable recording came from the publisher page; no authored sample transcript was substituted. The media and local vision cache were reused on the final browser rerun. Writing and review were run again with the downloaded local Qwen model.

## Content failures found and fixes

The local model omitted or changed numeric/cost details, mishandled bubble-sort flag behavior, and interpreted turning up number cards as increasing audio volume. Source-ID coverage had not detected those errors. The app now compares prose against the source, attempts one repair, and retains original wording in flagged passages. Conservative guards cover omitted numeric/boolean details, a limited cost-expression pattern, explanations adjacent to automatically read code, and certain unsupported classroom/recording details. They do not prove general semantic fidelity.

The delivered chapter retains original wording for **8 of 10 passages**; the other two are local model prose. It is a readable source-preserving draft with captured teaching screens, not the polished independent written tutorial required for product readiness. Remaining prose often reports what the instructor did rather than teaching directly. Caption boundary fragments remain. The original caption records are unchanged in the bundle. The final guard was applied to the fresh browser result through the same production function and the corrected bundle was reopened in the browser; no replacement textbook prose was manually inserted.

All 23 images are retained. Five frames with readable teaching content stay inline. Eighteen classroom or physical-demonstration frames that local vision called unreadable move to a compact PDF contact sheet and remain individually inspectable in Source & review/JSON. This selection can be wrong. A 15-second sample can miss brief edits or output. Vision OCR is not authenticated code, and source code is never executed.

## Local-only constraint

The cloud video connector and cloud choices were removed. The conversion pipeline rejects cloud video access and cloud writing requests before network activity. Tests cover the rejection. No Google video API call was made. Publisher pages/media still need downloading from the internet, but screen interpretation, writing and review run through loopback Ollama. No model API key is needed.

The original three YouTube acceptance checks still fail because the supported official caption download route needs editing permission that this app does not have. No additional authorized source URL is available for Karpathy. A public player URL alone does not supply an allowed local recording. The app does not work around that by scraping hidden caption/media endpoints, using cookies or proxies, or silently sending the source to a cloud model.

## Run and inspect

Use [START-HERE.md](START-HERE.md). Start Ollama and run `npm.cmd start` in this directory; open http://127.0.0.1:4317. Choose **Try a real MIT Python lecture**, then **Write this chapter**. Local generation can take several minutes. Choose a PDF style after the chapter finishes.

Open `mit-sorting-chapter.evidence.json` from the adjacent output folder to inspect the completed example without regeneration. The source archive excludes `.env`, installed dependencies, `.tools`, downloaded media, private job storage and caches. A fresh checkout needs dependency installation and FFmpeg setup as documented. MIT-derived outputs carry CC BY-NC-SA attribution and restrictions; the software archive does not include the downloaded lecture.

## Work still required

- Permitted, reliable source acquisition for the intended YouTube courses, including Karpathy, under local-only processing.
- Local transcription for permitted audio/video files and broader publisher integrations.
- Better writing quality with independent content checks; the current 4B model and rule guards are insufficient.
- Better selection of important visual states and reliable code/terminal transcription.
- A complete real long-course run, followed by a human learning/building test of the written edition.

Acceptance stays failed until these requirements pass on the actual target sources.
