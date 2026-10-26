# NanT release check — 26 October 2026

The specific source omission found on 25 October is fixed and reproduced successfully in the revised app. This is a **public beta for 5–10-minute chapters**, not a measured accuracy guarantee. The historical failed test remains in [USER-POV-REPORT.md](USER-POV-REPORT.md).

## Root cause and changes

The old reader transcribed a 90-second video window while choosing its own sentence timestamps. Earlier speech was stretched across the window; an explanation disappeared despite apparently complete timestamp coverage. Counting acquired IDs could not detect material never acquired.

- Read 30-second video clips using required, fixed 10-second audio cells. The server owns their keys and intervals; the model cannot invent sentence timestamps to cover a missing cell. Silence must be explicit. These are approximate acquisition intervals, not measured word or frame times.
- Assign teaching screens to the same intervals instead of accepting model-calculated timestamps. Preserve unfinished demonstration code as source data rather than treating program syntax as transcription completeness.
- Retry an invalid source response once against the original clip. Repeated failure remains an error, with completed steps saved. Each real attempt uses the normal shared quota.
- Version public source cache keys and video checkpoints. Old incomplete extractions cannot silently resume after the upgrade. Existing exported chapters remain available.
- Add the tested free Flash-Lite video fallback ahead of the other fallback. A genuine primary Gemini daily-limit response was observed; Flash-Lite subsequently acquired the missing explanation. No new account, key rotation, paid fallback or billing change was used.
- Write neighbouring speech cells as coherent paragraphs while checking every ID in order. Preserve numerical examples and underscore identifiers, or retain the original group when rewriting fails checks. Bound writing batches to avoid the larger request rejected by the provider.
- Preserve a grouped explanation across saved source-part boundaries. Keep exact source fragments exportable without inventing the ends of cut-off sentences.
- Distinguish application throttles and rejected requests from exhausted model capacity. Short application throttles pause and retry writing rather than prematurely downgrading it to a source transcript.
- Fix invalid-input recovery, retry labels, saved-history selection, chapter-window labels and busy-state PDF controls.

These structural checks reduce failure modes; they do not prove semantic completeness. Independent source comparisons remain necessary.

## Real conversions

| Check | Result |
| --- | --- |
| Python: `rfscVS0vtbw`, 18:49–23:49 | Completed with 30 acquired speech cells and 19 typed visual/code records. The previously absent 19:58–20:18 variable explanation is present before writing and in the PDF. |
| Python final writing | Seven teaching sections. Eight source cells retained their source wording after rewrite checks. All 30 acquired IDs remain represented in order. |
| Python export | Seven-page Textbook PDF downloaded through the public API client, reopened, text-extracted and rendered for visual inspection. No PDF text clipping or overlapping layout found in inspected pages. |
| C: `KJgsSFOSQv0`, 17:00–22:00 | Fresh source acquisition followed by a cached rerun through the final browser form. Completed with 29 speech passages and 20 visual records. Final UI showed an AI-written draft and returned PDF-ready status. |
| Independent source comparison | Used YouTube's normal transcript UI/export, separately from NanT's reader. Comparison found the original missing Python transition recovered and no further omitted interior passage in these two sampled windows. Surrounding caption context outside the requested windows was excluded from omission claims. |
| C teaching-point review | Retained semicolons, printing twice, newline characters, the triangle, changing instruction order, variables as containers, and the George/70 story example. Source and final displayed Markdown are saved privately for review. |
| Recovery | Real provider exhaustion, invalid source response, resume from saved source, cached reuse, source retention, assembly and export exercised. The C form resumed at its unfinished step after test-server restarts. |
| Browser file save | Pass on production: captured the download together with its button click, received an actual file in Downloads, reopened the 33,363-byte nine-page C PDF, extracted its teaching content and rendered representative pages. Earlier automation failures were resolved for this check. |

Private reference captions, reader responses, final displayed Markdown, exported JSON/PDF and rendered pages are in ignored `.local-data/user-test/` and `.local-data/hosted-acceptance/`. Generated creator course material is not committed to the public repository.

## Automated validation

**149 tests pass**, plus JavaScript syntax checks, the public build and `git diff --check`. Tests include missing cells, explicit quiet cells, bounded rereading, source-version changes, cross-part paragraph storage, preserving numeric/identifier details, exact-source recovery, reopening, quota errors and actual PDF bytes. Mock tests are separate from the real-provider evidence above.

## Limits that remain

Free provider capacity is finite and new acquisition can still pause when every compatible reader is unavailable. OpenRouter is a writing fallback, not a substitute YouTube video reader. Saved chapters and PDF rendering do not require another model call.

No 90% or 95% accuracy figure has been measured. Machine speech and code can contain errors; sampled or horizontally cropped editor views and deliberately unfinished edits require review. Not every intermediate code block is a standalone runnable program. Custom chapter boundaries can cut a sentence; retained wording must not be mistaken for a fabricated completion. This release does not claim a whole-course or independently certified teaching-completeness guarantee.

## Production

Published code commit **7609564** to GitHub and deployed it to the existing Vercel production project. Deployment `dpl_HVs9srcJkzyHngMwWW58tuiTbdve` reached **READY** and was aliased to [nant-sepia.vercel.app](https://nant-sepia.vercel.app/).

Anonymous HTTP checks returned 200 for the homepage, public configuration and new source policy; `/.env` returned 404. Configuration reports Gemini and OpenRouter connected, shared allowance 80 and daily per-connection cap 0.

A **new uncached production source request**, Python 19:58–20:28, returned 200 using **Gemini 3.5 Flash-Lite**. It included the two variables, replacing the story literal and the print-statement transition. This confirms the deployed source reader and compatible free video fallback, separate from cached chapter reruns.

The public browser form then completed the C 17:00–22:00 chapter, displayed all 29 acquired passages and 20 visual records, and generated its PDF. The actual browser download was saved, reopened and checked as described above. Final Python example code was also checked with restricted AST evaluation (no imported code executed): syntax and the demonstrated variable-reassignment values were correct.

The source-omission release blocker is resolved in these sampled chapters. The site is live for a **limited public beta**, with the fidelity and finite-capacity limits above. No paid service or plan was enabled.
