import { assert } from './errors.js';
import { seconds } from './transcript.js';

// Only automatic observations explicitly reporting no readable teaching text
// move out of the lesson. Their original images remain in the PDF contact sheet
// and the full evidence bundle, including physical demonstrations.
export function isContextFrame(event) {
  return event.kind === 'frame' && Boolean(event.image) && /Extracted automatically from the (?:publisher-linked video|public YouTube video|uploaded recording)/.test(event.origin || '') && /^\[?No (?:teaching content is legible|legible teaching content visible)\b/i.test(event.content);
}

export function partitionFrames(chapter,evidence){
  const automatic=event=>event.kind==='frame' && event.image && /Extracted automatically/.test(event.origin || '');
  const chosen=new Set(evidence.filter(event=>!automatic(event)).map(event=>event.id));
  for(const segment of chapter.segments){
    const frames=evidence.filter(event=>automatic(event) && !isContextFrame(event) && event.at>=segment.start && event.at<segment.end);
    if(frames.length)chosen.add(frames.at(-1).id);
    // Keep both ends of explicit mistake/correction demonstrations in the lesson.
    if(frames.length && /\b(error|wrong|fix|mistake|replace|corrected|change|changing|instead|update)\b/i.test(segment.text))chosen.add(frames[0].id);
  }
  for(const event of evidence)if(automatic(event) && /\b(traceback|syntaxerror|typeerror|referenceerror)\b/i.test(event.content))chosen.add(event.id);
  return {primary:evidence.filter(event=>chosen.has(event.id)),additional:evidence.filter(event=>!chosen.has(event.id))};
}

export function normalizeEvidence(input = []) {
  assert(Array.isArray(input) && input.length <= 1200, 'Visual evidence must be an array with at most 1,200 events.');
  let imageBytes = 0;
  return input.map((row, index) => {
    assert(row && typeof row === 'object', `Evidence ${index + 1} must be an object.`);
    const at = seconds(row.at);
    assert(Number.isFinite(at) && at >= 0 && at <= 86400, `Evidence ${index + 1} needs a valid timestamp.`);
    assert(['code', 'terminal', 'diagram', 'note', 'frame'].includes(row.kind), `Evidence ${index + 1} has an unknown kind.`);
    assert(typeof row.content === 'string' && row.content.trim() && row.content.length <= 30000, `Evidence ${index + 1} needs text describing or transcribing what is visible.`);
    let image = null;
    if (row.image) {
      assert(typeof row.image === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(row.image), 'Frames must be inline PNG, JPEG, or WebP images. External URLs and SVG are not accepted.');
      imageBytes += row.image.length;
      assert(row.image.length <= 1_000_000 && imageBytes <= 4_000_000, 'Use frames under 750 KB each and about 3 MB total.');
      image = row.image;
    }
    return { id: `e${String(index + 1).padStart(4, '0')}`, at, kind: row.kind,
      title: typeof row.title === 'string' ? row.title.slice(0, 200) : row.kind,
      content: row.content, language: /^[\w+-]{1,20}$/.test(row.language || '') ? row.language : 'text',
      origin: typeof row.origin === 'string' ? row.origin.slice(0, 300) : 'User-supplied visual record; not independently checked', image };
  }).sort((a, b) => a.at - b.at);
}
export function selectEvidence(evidence, chapter) {
  // Retain every supplied event in the window; no silent top-k dropping of code states.
  return evidence.filter(e => e.at >= Math.min(chapter.start, chapter.actualStart) && e.at < Math.max(chapter.end, chapter.actualEnd));
}
export function planFrames(chapter, selected) {
  const targets = new Map();
  for (let at = chapter.start; at < chapter.end; at += 60) targets.set(at, 'Periodic screen check');
  for (const segment of chapter.segments) {
    if (/\b(here|screen|output|terminal|diagram|look|shape|error|change|matrix|this line)\b/i.test(segment.text)) targets.set(segment.start, 'Speech refers to visible code, output, or a diagram');
  }
  for (const event of selected) targets.set(event.at, `Supplied ${event.kind} evidence`);
  return [...targets].sort((a, b) => a[0] - b[0]).map(([at, reason]) => ({ at, reason,
    evidenceIds: selected.filter(e => Math.abs(e.at - at) <= 3).map(e => e.id),
    status: selected.some(e => Math.abs(e.at - at) <= 3) ? 'record-supplied' : 'capture-needed' }));
}
