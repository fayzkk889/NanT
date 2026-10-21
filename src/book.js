import {MAX_BOOK_CHAPTERS} from '../public/course-bundle.js';
import { assert } from './errors.js';
import { verify } from './verification.js';
import { renderMarkdown } from './markdown.js';
export function combineChapters(chapters) {
  assert(Array.isArray(chapters) && chapters.length && chapters.length <= MAX_BOOK_CHAPTERS,'A book needs 1–96 completed chapters.');
  const first = chapters[0];
  assert(chapters.every(c=>c.source.id === first.source.id),'Book chapters must share one source.');
  const segments = chapters.flatMap(c=>c.chapter.segments);
  assert(new Set(segments.map(s=>s.id)).size === segments.length,'A book cannot duplicate source cues across chapters.');
  const chapter = {start:segments[0].start,end:Math.max(...segments.map(s=>s.end)),actualStart:segments[0].start,actualEnd:Math.max(...segments.map(s=>s.end)),segments,planned:true};
  const evidence = chapters.flatMap((c,index)=>c.evidence.map(e=>({...e,id:`c${index+1}-${e.id}`})));
  const reviews=chapters.map(c=>c.generated.review).filter(Boolean),models=[...new Set(chapters.map(c=>c.generated.model).filter(Boolean))];
  const readingVersion=first.generated.readingMaterials?.version;
  const readingReady=Boolean(readingVersion) && chapters.every(c=>c.generated.readingMaterials?.version===readingVersion);
  const generated = {...first.generated, groundingCorrections:chapters.flatMap((c,i)=>(c.generated.groundingCorrections || []).map(e=>({...e,frameIds:(e.frameIds || []).map(id=>`c${i+1}-${id}`)}))),factCorrections:chapters.flatMap((c,i)=>(c.generated.factCorrections || []).map(e=>({...e,frameIds:(e.frameIds || []).map(id=>`c${i+1}-${id}`)}))),screenExamples:chapters.flatMap((c,i)=>(c.generated.screenExamples || []).map(e=>({...e,frameIds:(e.frameIds || []).map(id=>`c${i+1}-${id}`)}))),model:models.join(', ') || undefined,inspectedFrameIds:chapters.flatMap((c,i)=>(c.generated.inspectedFrameIds || []).map(id=>`c${i+1}-${id}`)),review:reviews.length?{status:reviews.some(r=>r.status==='source_retained')?'source_retained':reviews.length!==chapters.length || reviews.some(r=>r.status==='unavailable')?'unavailable':reviews.every(r=>r.status==='passed')?'passed':'issues_found',issues:reviews.flatMap(r=>r.issues || []),ungroundedIssues:reviews.reduce((sum,r)=>sum+(r.ungroundedIssues || 0),0)}:undefined,mode:chapters.every(c=>c.generated.mode === 'model') ? 'model' : 'source', generationFailed:chapters.some(c=>c.generated.generationFailed),
    readingMaterials:readingReady?{version:readingVersion,machineRead:chapters.some(c=>c.generated.readingMaterials.machineRead),items:chapters.flatMap((c,i)=>c.generated.readingMaterials.items.map(item=>({...item,id:`c${i+1}-${item.id}`,sourceFrameIds:(item.sourceFrameIds || []).map(id=>`c${i+1}-${id}`)})))}:undefined,
    sourceFallbackSegments:chapters.flatMap(c=>c.generated.sourceFallbackSegments || []),
    warnings:[...new Set(chapters.flatMap(c=>c.generated.warnings))], draft:{title:first.source.title,sections:chapters.flatMap((c,index)=>c.generated.draft.sections.map((s,j)=>({...s,heading:j === 0 ? `Chapter ${index+1}: ${s.heading}` : s.heading})))}};
  const framePlan = chapters.flatMap(c=>c.framePlan), report = verify(chapter,evidence,framePlan,generated);
  report.limits = 'All timestamped source cues are assigned once across the completed chapters. Structural coverage does not prove conceptual fidelity or that every brief visual state was captured. Review the source and sampled frames.';
  const result = {schemaVersion:2,source:first.source,provenance:first.provenance,chapter,evidence,framePlan,generated,report,chapters,windowLength:first.windowLength || 480,
    chapterPlan:chapters.map((c,index)=>({index,start:c.chapter.start,end:c.chapter.end})),conversionScope:'full-video',createdAt:new Date().toISOString()};
  result.markdown = renderMarkdown(result); return result;
}
