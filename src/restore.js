import {MAX_BOOK_CHAPTERS} from '../public/course-bundle.js';
import { assert } from './errors.js';
import { parseTranscript, selectChapter, planChapters, navigationWindows } from './transcript.js';
import { parseYouTubeURL } from './youtube.js';
import { normalizeEvidence, selectEvidence, planFrames } from './evidence.js';
import { validateDraft, sourceDraft } from './generation.js';
import { verify } from './verification.js';
import { renderMarkdown } from './markdown.js';
import { combineChapters } from './book.js';

export function restoreChapter(data) {
  if (data?.schemaVersion === 2 && data.conversionScope === 'full-video') {
    assert(Array.isArray(data.chapters) && data.chapters.length && data.chapters.length <= MAX_BOOK_CHAPTERS,'The exported book needs 1–96 chapters.');
    return combineChapters(data.chapters.map(restoreChapter));
  }
  assert(data?.schemaVersion === 1 && data.chapter && data.source && data.generated, 'Choose an exported NanT evidence JSON file.');
  const rawSegments = data.chapter.segments;
  const segments = parseTranscript(rawSegments);
  const ids = rawSegments.map(s => s.id);
  assert(ids.every(id => typeof id === 'string' && /^s\d{5}$/.test(id)) && new Set(ids).size === ids.length, 'The saved chapter has invalid source IDs.');
  segments.forEach((s, i) => s.id = ids[i]);
  const start = Number(data.chapter.start), duration = Number(data.chapter.end) - start;
  assert(([300, 480, 600].includes(duration) || data.chapter.planned === true && duration > 0 && duration <= 660) && start >= 0 && start + duration <= 86400, 'The saved chapter has an invalid time window.');
  const chapter = {...selectChapter(segments,start,duration),...(data.chapter.planned ? {planned:true} : {})};
  assert(typeof data.source.title === 'string' && data.source.title.length <= 300 && typeof data.source.author === 'string' && data.source.author.length <= 200, 'The saved chapter needs a valid source title and author.');
  const link = data.source.url ? parseYouTubeURL(data.source.url) : null;
  assert(link || data.source.synthetic === true || ['local-import','local-media'].includes(data.source.kind), 'A saved chapter needs a video URL, a local-recording source, or an explicit original-fixture label.');
  const source = { ...data.source, ...(link || {}), synthetic: !link && !['local-import','local-media'].includes(data.source.kind) };
  const evidence = selectEvidence(normalizeEvidence(data.evidence || []), chapter);
  const mode = data.generated.mode === 'model' ? 'model' : 'source';
  let draft;
  try { draft = mode === 'model' ? validateDraft(data.generated.draft, chapter.segments) : sourceDraft(chapter); }
  catch { assert(false, 'The saved prose omits, reorders, or excessively compresses its source. Choose an intact chapter export.'); }
  const generated = { ...data.generated, mode, draft,
    warnings: ['Imported saved chapter. The claimed writing origin and source alignment have not been independently authenticated.', ...(Array.isArray(data.generated.warnings) ? data.generated.warnings.filter(w => typeof w === 'string').slice(0, 50).map(w => w.slice(0, 2000)) : [])] };
  const framePlan = planFrames(chapter, evidence), report = verify(chapter, evidence, framePlan, generated);
  const result = { schemaVersion: 1, source, provenance: `Imported chapter. ${String(data.provenance || '').slice(0, 1500)}`, chapter, evidence, framePlan, report, generated,windowLength:[300,480,600].includes(data.windowLength) ? data.windowLength : 480,
    chapterPlan: navigationWindows(chapter.segments,[300,480,600].includes(data.windowLength) ? data.windowLength : 480,source), conversionScope: 'one-chapter', createdAt: new Date().toISOString() };
  result.markdown = renderMarkdown(result);
  return result;
}
