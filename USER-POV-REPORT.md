# NanT user acceptance test — 25 October 2026

**Follow-up:** the original source omission was reproduced and fixed on 26 October. See [the subsequent release check](RELEASE-CHECK-2026-10-26.md) for the changes, real-source reruns and remaining limits. This file preserves the earlier failed test.

**Release decision: HOLD.** The live conversion workflow works, but a fresh independent source comparison found an omitted teaching passage. The customer's requirement that important explanations are not missing has not passed. Earlier functional checks and acquired-passage counts were insufficient evidence for that requirement.

## Test scope and results

Tested the public site through its normal browser controls, without supplying visitor API keys. The new source was Mike Dane / Giraffe Academy's [Python course published by freeCodeCamp](https://www.youtube.com/watch?v=rfscVS0vtbw), **18:49–23:49**. The isolated local preview was used for checking fixes, without publishing them.

| User action | Observed result |
| --- | --- |
| Open the public site without signing in | Pass: live study desk and shared connection available. |
| Enter an unsupported website link | Rejected with a useful message. Live UI incorrectly offered saved-step resumption despite acquiring no source; fixed and checked locally. |
| Enter an invalid timestamp | Pass: readable validation message and editable form. |
| Convert a previously untested Python chapter through the UI | Functional pass: 22 acquired speech passages and 8 visual/code records displayed. Content acceptance failed below. |
| Read the chapter independently | Fail: a transition explaining use of the variables inside the story was absent; subsequent prose began mid-sentence. |
| Stop writing, refresh, then resume | Pass: the completed source reads survived; resumption went directly to writing rather than rereading the video. |
| Choose an older saved chapter, then refresh | Live failure reproduced: choosing Karpathy then refreshing reopened Python. Corrected and retested locally. |
| Distinguish saved chapters from the same course | Live labels lacked time windows. Local labels now include start/end times. |
| Reopen a real exported JavaScript source bundle | Pass in local preview: chapter restored without a model call. |
| Select Study notes and Code Companion at phone size | Pass in local preview: controls accessible and PDF-ready response received. |
| Check phone layout at 390 × 844 | Pass: no horizontal page overflow; export controls remained available. Temporary viewport override reset afterward. |
| Verify a completed file download through browser automation | Inconclusive: the download-event adapter stalled and reset. Generation/reopening were checked separately; this adapter problem is not proof of a product download failure. |

## Content blocker: acquired coverage is not original-source completeness

The generated chapter showed **22/22 acquired source passages included**. Independently opening YouTube's normal **Show transcript** panel exposed source material that was absent from those 22 passages.

At approximately **19:58–20:18**, the original transcript explains that the two variables now represent the character's name and age, and introduces replacing the literal story text with those variables inside the print statement. That transition does not occur in the acquired speech record. The following acquired passage begins **“of things.”** and continues with closing quotation marks. The written lesson preserves that broken transition because its source was already incomplete.

The first extraction window was 18:49–20:19. Its last acquired cue repeats the earlier age-assignment explanation while claiming to extend to 20:19. This is evidence of source-reading/timestamp drift, not simply a failure to include an acquired ID during writing. More accurate rewriting or a prettier PDF cannot recover speech the source reader omitted.

YouTube captions are an independent comparison source, not a perfect audio gold standard. Nevertheless, this concrete missing transition is enough to fail the no-omission acceptance requirement. No accuracy percentage is inferred from word counts. The recorded captions include neighboring context and differ in cue grouping from the acquired source, so their word totals must not be presented as an accuracy score.

Private evidence is retained under ignored `.local-data/user-test/`:

- `python-youtube-transcript.json`: the chapter's captions observed in YouTube's transcript panel.
- `python-acquired-parts.json`: the four actual cached source responses from the live conversion; every response confirmed reuse, with no additional model calls.
- `python-live-lesson.md`: Markdown read directly from the live chapter UI.

The full four-hour transcript and generated course material are not included in source control.

## Local fixes prepared

- Validate YouTube links and time windows before starting conversion or showing reading progress.
- Label a retry accurately when no source steps have completed.
- Persist chapter setup before the first source read and restore the saved input when resuming.
- Save the selected history entry so refresh returns to that chapter.
- Include time windows in history labels and preserve the sample selection on refresh.
- Disable the mobile PDF action consistently while work is busy.

The corrected history flow was checked with a real reopened JavaScript chapter and the authored tokenizer sample: selecting JavaScript after the newer sample, then refreshing, still showed JavaScript. **139 automated regression tests pass**, including the new validation/label checks. These tests do not override the failed manual content audit.

**No deployment or public release was performed in this test pass.** The usability fixes remain local for review. The source-acquisition omission remains unresolved.

## Required before release

Correct the source acquisition and independently recheck this failing interval, then repeat the check on another unfamiliar chapter. Use the original transcript/audio and teaching screens as the reference. A generated passage count, source-shaped timestamps, provider fallback, and a successful PDF export are not substitutes for this check. Confirm actual file saving in a regular supported browser as well as export generation.
