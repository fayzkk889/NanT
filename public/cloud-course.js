export function formatTime(value){const s=Math.floor(value);return `${s>=3600?Math.floor(s/3600)+':':''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
export function chapterParts(start,duration){return Array.from({length:Math.ceil(duration/90)},(_,i)=>({start:start+i*90,end:Math.min(start+(i+1)*90,start+duration)}));}
export function writingBatches(parts){
  const batches=[];let indices=[],chars=0,cues=0;
  const flush=()=>{if(indices.length)batches.push(indices);indices=[];chars=0;cues=0;};
  parts.forEach((part,index)=>{if(part.writing){flush();return;}const cost=JSON.stringify({segments:part.segments,evidence:part.evidence}).length;if(indices.length&&(chars+cost>14000||cues+part.segments.length>100))flush();indices.push(index);chars+=cost;cues+=part.segments.length;});flush();return batches;
}
export function applyWritingBatch(parts,indices,writing){
  for(const index of indices){const ids=new Set(parts[index].segments.map(s=>s.id));parts[index].writing={...writing,draft:{...writing.draft,sections:writing.draft.sections.filter(s=>s.segment_ids.every(id=>ids.has(id)))},retained:(writing.retained||[]).filter(id=>ids.has(id))};}
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
