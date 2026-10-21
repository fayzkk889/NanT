import { timeLabel } from './transcript.js';
import { timestampURL } from './youtube.js';
import { partitionFrames } from './evidence.js';
import {usableExamples,exampleText} from './screen-examples.js';

function plain(text) { return String(text).replace(/[\r\n]+/g, ' ').replace(/[\[\]<>#*_`]/g, ''); }
function quote(text) { return String(text).split('\n').map(line => `> ${line}`).join('\n'); }
function fenced(content, language = 'text') {
  const longest = Math.max(2, ...(content.match(/`+/g) || []).map(s => s.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${content}\n${fence}`;
}
function stamp(source, at) {
  const link = timestampURL(source, at);
  return link ? `[${timeLabel(at)}](${link})` : `${timeLabel(at)} (${source.synthetic ? 'fixture time; no source video' : 'local source timestamp'})`;
}
export function renderMarkdown(result) {
  const { source, chapter, evidence, generated, report } = result;
  const examples=usableExamples(generated.screenExamples,chapter.segments);
  const lines = [`# ${plain(generated.draft.title)}`, '', `Source: ${plain(source.title)} · ${plain(source.author)}`, '',
    `Window: ${stamp(source, chapter.start)}–${timeLabel(chapter.end)} · ${generated.mode === 'model' ? 'AI-written draft' : 'Source-preserving edition'} · Needs review`, '',
    `Provenance: ${plain(result.provenance)}`, '',
    ...[...generated.warnings, ...report.warnings].flatMap(w => [`> ${plain(w)}`, ''])];
  if (source.license) lines.push(`License: [${plain(source.license.name)}](${source.license.url}). ${plain(source.license.attribution)} ${plain(source.license.notice)}`, '');
  if(source.relatedCode)lines.push(`Related code: [${plain(source.relatedCode.title)}](${source.relatedCode.url}). ${plain(source.relatedCode.license)}. This reference may represent a later code state; captured screens establish the chapter timeline.`, '');
  if (source.synthetic) lines.push('> ORIGINAL TEST FIXTURE. This is an authored eight-minute lesson, not a transcript of Karpathy or a recording. Times simulate a video timeline.', '');
  // Prose and supplied on-screen evidence form one chronological event stream.
  // A model section can cover several cues; split only on section boundaries, never drop events.
  const stream = generated.draft.sections.map((section, index) => ({ at: chapter.segments.find(s => s.id === section.segment_ids[0]).start, type: 'section', section, index }));
  const selected=partitionFrames(chapter,evidence),contextFrames=selected.additional;
  stream.push(...examples.map(example=>({at:example.at,type:'example',example})));
  stream.push(...selected.primary.map(event => ({ at: event.at, type: 'evidence', event })));
  const rank={section:0,example:1,evidence:2};stream.sort((a,b)=>a.at-b.at || rank[a.type]-rank[b.type] || (a.index || 0)-(b.index || 0));
  for (const item of stream) {
    if (item.type === 'section') {
      const { section } = item;
      const prose = section.heading.startsWith('Original explanation:') ? section.markdown.replace(/([^\n])\n(?!\n)/g,'$1 ') : section.markdown;
      lines.push(`## ${plain(section.heading)}`, '', `${stamp(source, item.at)} · Source ${section.segment_ids.join(', ')}`, '', prose, '');
    } else if(item.type==='example'){
      lines.push('### Displayed example','',`${stamp(source,item.at)} · Repeated machine reading; compare the original screen.`, '',fenced(exampleText(item.example),'text'),'');
    } else {
      const e = item.event;
      lines.push(`### ${plain(e.title)}`, '', `${stamp(source, e.at)} · ${e.id} · ${e.kind} · ${plain(e.origin)}`, '');
      if (['code', 'terminal', 'frame'].includes(e.kind)) lines.push(fenced(e.content, e.kind === 'code' ? e.language : 'text'), '');
      else lines.push(quote(e.content), '');
      // Inline image assets are exported in the JSON evidence bundle. Avoid huge data URLs in Markdown.
      if (e.image) lines.push(`Frame image: see ${e.id} in the exported evidence JSON.`, '');
    }
  }
  if (contextFrames.length) lines.push('## Additional captured frames', '', `${contextFrames.length} additional captures remain in Source & review, the evidence JSON, and the PDF contact sheet at their original embedded resolution. The lesson selects a screen near each passage end and both ends of explicit mistake/correction demonstrations. Earlier or brief states may matter; this automatic selection needs review.`, '', ...contextFrames.map(e=>`- ${stamp(source,e.at)} · ${e.id}`), '');
  if (generated.mode === 'model') {
    lines.push('## Source wording for comparison', '', 'The complete supplied transcript is retained below for auditing the AI-written prose.', '');
    for (const s of chapter.segments) lines.push(`### ${s.id} · ${stamp(source, s.start)}`, '', quote(s.text), '');
  }
  lines.push('## Fidelity report', '',
    `- Source ID coverage: ${report.segmentCoverage.covered}/${report.segmentCoverage.total}`, `- Chronological source assignment: ${report.chronologicalOrder ? 'passed' : 'failed'}`,
    `- Exact supplied code states: ${report.codeStates}`, `- Supplied terminal records: ${report.terminalRecords}`,
    `- Semantic fidelity: NOT VERIFIED`, '', report.limits, '');
  return lines.join('\n');
}
