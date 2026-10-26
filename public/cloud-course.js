export function formatTime(value){const s=Math.floor(value);return `${s>=3600?Math.floor(s/3600)+':':''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
import {SOURCE_PART_SECONDS} from './source-policy.js';
export function chapterParts(start,duration){return Array.from({length:Math.ceil(duration/SOURCE_PART_SECONDS)},(_,i)=>({start:start+i*SOURCE_PART_SECONDS,end:Math.min(start+(i+1)*SOURCE_PART_SECONDS,start+duration)}));}
export function sourceInputError(input){
  if(!Number.isFinite(input.start)||input.start<0||![300,480,600].includes(input.duration)||input.start+input.duration>86400)return 'Choose a valid chapter start, such as 08:00.';
  if(input.sourceType!=='youtube')return null;
  try{
    const raw=input.url.trim(),url=new URL(/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(raw)?`https://${raw}`:raw),host=url.hostname.toLowerCase();
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port)throw new Error();
    const id=host==='youtu.be'?url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1]:['youtube.com','www.youtube.com','m.youtube.com'].includes(host)?url.pathname==='/watch'?url.searchParams.get('v'):url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1]:null;
    if(!/^[\w-]{11}$/.test(id||''))throw new Error();return null;
  }catch{return 'Use a YouTube video link, not a playlist or another website.';}
}
export function savedChapterLabel(row){const chapter=row.result.chapter;return `${row.title} · ${formatTime(chapter.start)}–${formatTime(chapter.end)}`;}
export function resumeButtonLabel(checkpoint){return checkpoint?.parts?.length?'Resume saved steps ↗':'Try this chapter again ↗';}
export function writingBatches(parts){
  const batches=[];let indices=[],chars=0,cues=0;
  const flush=()=>{if(indices.length)batches.push(indices);indices=[];chars=0;cues=0;};
  parts.forEach((part,index)=>{if(part.writing){flush();return;}const cost=JSON.stringify({segments:part.segments,evidence:part.evidence}).length;if(indices.length&&(chars+cost>8000||cues+part.segments.length>12))flush();indices.push(index);chars+=cost;cues+=part.segments.length;});flush();return batches;
}
export function applyWritingBatch(parts,indices,writing){
  // Store a grouped explanation on the part owning its first cue. Later cues
  // can cross a part boundary; duplicating/filtering by every ID loses them.
  for(const index of indices){const ids=new Set(parts[index].segments.map(s=>s.id));parts[index].writing={...writing,draft:{...writing.draft,sections:writing.draft.sections.filter(s=>ids.has(s.segment_ids[0]))},retained:(writing.retained||[]).filter(id=>ids.has(id))};}
}
export function readSeconds(value){if(/^\d+$/.test(value))return Number(value);const parts=value.split(':').map(Number);if(parts.length<2||parts.length>3||parts.some(n=>!Number.isInteger(n)||n<0)||parts.slice(1).some(n=>n>=60))return NaN;return parts.reduce((n,v)=>n*60+v,0);}
function fence(text,language='text'){const n=Math.max(2,...(text.match(/`+/g)||[]).map(s=>s.length))+1,mark='`'.repeat(n);return `${mark}${language}\n${text}\n${mark}`;}
export function cleanLessonMarkdown(result,{timestamps=false,source=false}={}){
  const lines=[`# ${result.generated.draft.title}`,'',`Source: ${result.source.title} · ${result.source.author}`,''];
  if(result.source.url)lines.push(`[Original lesson](${result.source.url})`,'');
  const events=result.generated.draft.sections.map(section=>({at:result.chapter.segments.find(s=>s.id===section.segment_ids[0])?.start??0,section}));
  events.push(...result.evidence.map(e=>({at:e.at,evidence:e})));events.sort((a,b)=>a.at-b.at);
  for(const event of events){
    const heading=event.section?.heading||event.evidence.title;lines.push(`## ${heading}`,'');
    if(timestamps&&result.source.url)lines.push(`[${formatTime(event.at)}](${result.source.url}${result.source.url.includes('?')?'&':'?'}t=${Math.floor(event.at)}s)`,'');
    if(event.section)lines.push(event.section.markdown,'');
    else lines.push(['code','terminal','diagram'].includes(event.evidence.kind)?fence(event.evidence.content,event.evidence.language||'text'):event.evidence.content,'');
  }
  if(source){lines.push('## Source wording for comparison','');for(const segment of result.chapter.segments)lines.push(`### ${formatTime(segment.start)} · ${segment.id}`,'',segment.text,'');}
  return lines.join('\n');
}
