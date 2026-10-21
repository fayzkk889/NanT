import { assert } from './errors.js';

export function seconds(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) return NaN;
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4] || 0}`);
}
export function timeLabel(value) {
  const whole = Math.floor(value);
  const h = Math.floor(whole / 3600), m = Math.floor(whole / 60) % 60, s = whole % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function cleanCaption(text) {
  return text.replace(/<\/?(?:c(?:\.[^ >]+)?|v(?: [^>]+)?|i|b|u|lang(?: [^>]+)?)>/g, '')
    .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}
export function normalizeSegments(rows) {
  assert(Array.isArray(rows) && rows.length > 0, 'The transcript needs at least one timestamped segment.');
  assert(rows.length <= 20000, 'Import at most 20,000 transcript segments.');
  let lastStart = -1;
  return rows.map((row, index) => {
    assert(row && typeof row === 'object', `Transcript segment ${index + 1} must be an object.`);
    const start = seconds(row.start), end = row.end == null ? start + Number(row.duration) : seconds(row.end);
    assert(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= 86400,
      `Segment ${index + 1} needs valid start/end times (seconds or HH:MM:SS), within 24 hours.`);
    assert(start >= lastStart, `Segment ${index + 1} is out of order. Supply captions in teaching order.`);
    assert(typeof row.text === 'string' && row.text.trim() && row.text.length <= 30000,
      `Segment ${index + 1} needs non-empty text, at most 30,000 characters.`);
    lastStart = start;
    return { id: `s${String(index + 1).padStart(5, '0')}`, start, end, text: row.text.trim(), heading: typeof row.heading === 'string' ? row.heading.slice(0, 200) : '', ...(row.endEstimated ? { endEstimated: true } : {}) };
  });
}
export function parseTranscript(input) {
  if (Array.isArray(input)) return normalizeSegments(input);
  if (input && typeof input === 'object') return parseTranscript(input.segments ?? input.transcript);
  assert(typeof input === 'string' && input.trim(), 'Import a VTT, SRT, or JSON transcript.');
  assert(Buffer.byteLength(input) <= 2_000_000, 'Transcript imports are limited to 2 MB.');
  const trimmed = input.replace(/^\uFEFF/, '').trim();
  if (/^[\[{]/.test(trimmed)) {
    let data;
    try { data = JSON.parse(trimmed); } catch { assert(false, 'The transcript JSON is invalid.'); }
    return parseTranscript(data);
  }
  if (!trimmed.includes('-->') && /^\d{1,2}:\d{2}/.test(trimmed)) {
    // Accept the timestamp/text format users copy from a visible transcript.
    // Cue ends are inferred, never presented as measured video boundaries.
    const timed = [];
    for (const line of trimmed.replace(/\r\n?/g, '\n').split('\n')) {
      if (!line.trim()) continue;
      const match = line.trim().match(/^((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\s+(.*))?$/);
      if (match) timed.push({ start: seconds(match[1]), text: match[2] || '' });
      else { assert(timed.length > 0, 'Put a timestamp before the transcript text.'); timed[timed.length - 1].text += `${timed[timed.length - 1].text ? '\n' : ''}${line}`; }
    }
    return normalizeSegments(timed.map((row, index) => ({ ...row, end: timed[index + 1]?.start ?? row.start + 5, endEstimated: true })));
  }
  const blocks = trimmed.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  const rows = [];
  for (const block of blocks) {
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(block)) continue;
    const lines = block.split('\n');
    const timing = lines.findIndex(line => line.includes('-->'));
    if (timing < 0) {
      assert(block.startsWith('WEBVTT'), 'Unrecognized subtitle block. Use VTT, SRT, or timestamped JSON.');
      continue;
    }
    const parts = lines[timing].trim().split(/\s+-->\s+/);
    assert(parts.length === 2, 'A subtitle timing line is malformed.');
    rows.push({ start: parts[0], end: parts[1].split(/\s/)[0], text: cleanCaption(lines.slice(timing + 1).join('\n')) });
  }
  return normalizeSegments(rows);
}
export function planChapters(segments, length = 480) {
  const chapters = [];
  // Each cue belongs to exactly one chapter. Cue boundaries remain intact.
  let current;
  for (const segment of segments) {
    if (!current || segment.start >= current.start + length) {
      if (current) chapters.push(current);
      current = { index: chapters.length, start: segment.start, end: segment.end, segmentIds: [] };
    }
    current.end = Math.max(current.end, segment.end);
    current.segmentIds.push(segment.id);
  }
  if (current) chapters.push(current);
  return chapters;
}
export function selectChapter(segments, start, duration) {
  const end = start + duration;
  const selected = segments.filter(s => s.start < end && s.end > start);
  assert(selected.length > 0, 'No transcript segments overlap this chapter window. Choose a different start time.');
  assert(selected.length <= 2000, 'This chapter has over 2,000 cues. Import merged sentence-level captions or choose a shorter window.');
  assert(selected.reduce((n, s) => n + s.text.length, 0) <= 100000, 'Chapter transcript exceeds 100,000 characters. Choose a shorter chapter.');
  return { start, end, segments: selected, actualStart: selected[0].start, actualEnd: Math.max(...selected.map(s => s.end)) };
}

export function navigationWindows(segments,length,source={}){
  if(source.machineTranscript && Number.isFinite(source.duration) && source.duration>0 && source.duration<=86400)return Array.from({length:Math.ceil(source.duration/length)},(_,index)=>({index,start:index*length,end:Math.min((index+1)*length,source.duration),segmentIds:[]}));
  return planChapters(segments,length);
}
