import {assert} from './errors.js';
import {parseTranscript,selectChapter,planChapters} from './transcript.js';
import {normalizeEvidence,planFrames} from './evidence.js';
import {parseYouTubeURL} from './youtube.js';
import {validateDraft} from './generation.js';
import {verify} from './verification.js';
import {renderMarkdown} from './markdown.js';
import {SOURCE_PART_SECONDS} from '../public/source-policy.js';

export function assembleCloudCourse(input){
  const {start,duration,parts}=input;
  assert(Number.isFinite(start)&&start>=0&&[300,480,600].includes(duration)&&start+duration<=86400,'Choose a 5–10-minute chapter.');
  assert(Array.isArray(parts)&&parts.length>0&&parts.length<=20,'The saved chapter has invalid parts.');
  const isTranscript=input.sourceType==='local';
  let source;
  if(isTranscript)source={id:'local-import',kind:'local-import',title:String(input.title||'My programming lesson').slice(0,300),author:'User-supplied transcript',url:null,synthetic:false};
  else source={...parseYouTubeURL(input.url),title:String(parts[0].title||'Programming lesson').slice(0,300),author:String(parts[0].author||'Original video creator').slice(0,200),synthetic:false,metadataOrigin:'Video reader metadata; verify original attribution'};
  const segments=parts.flatMap(part=>part.segments),normalized=parseTranscript(segments);
  assert(segments.every((row,i)=>row.id===normalized[i].id),'The saved chapter has missing or repeated source IDs.');
  if(!isTranscript){let cursor=start;for(const part of parts){assert(part.start===cursor&&part.end>cursor&&part.end-cursor<=SOURCE_PART_SECONDS,'A video part is missing or out of order. Refresh and reread its source.');cursor=part.end;}assert(cursor===start+duration,'The video window is incomplete.');}
  const chapter=selectChapter(normalized,start,duration),evidence=normalizeEvidence(parts.flatMap(part=>part.evidence||[]));
  const draft={title:parts[0].writing?.draft?.title||source.title,sections:parts.flatMap(part=>part.writing?.draft?.sections||[])};
  validateDraft(draft,chapter.segments);
  const retained=parts.flatMap(part=>part.writing?.retained||[]);
  const capacityRetained=parts.filter(p=>p.writing?.recoveryReason==='capacity').flatMap(p=>p.writing.retained||[]).length;
  const sourceOnly=input.useModel===false||retained.length===chapter.segments.length||parts.every(p=>p.writing?.provider==='source');
  const generated={mode:sourceOnly?'source':'model',provider:'shared-free',model:'Shared free-tier model',draft,sourceFallbackSegments:retained,warnings:[isTranscript?'Written from your supplied transcript and visual records.':'Speech and teaching screens were machine-read from the video by Gemini. Transcription, code punctuation, sampled visual states and completeness need checking; no original video frames are stored in this edition.',...(retained.length>capacityRetained?[`${retained.length-capacityRetained} explanation(s) retain the original source wording because rewriting failed validation.`]:[]),...(capacityRetained?[`${capacityRetained} explanation(s) retain acquired source wording because free writing providers were unavailable. This is source recovery, not a polished rewrite.`]:[]),...parts.flatMap(p=>p.uncertainties||[])],review:{status:'unavailable',reason:'No independent semantic fidelity score has been measured.'}};
  const framePlan=planFrames(chapter,evidence),report=verify(chapter,evidence,framePlan,generated);
  const result={schemaVersion:1,source,chapter,evidence,generated,framePlan,report,provenance:isTranscript?'User-supplied timestamped transcript and visual records.':'Gemini video source reading, followed by separate writing of each chronological source part. Free-tier cloud processing.',chapterPlan:planChapters(chapter.segments,duration),windowLength:duration,conversionScope:'one-chapter',createdAt:new Date().toISOString()};
  result.markdown=renderMarkdown(result);return result;
}
