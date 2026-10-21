import {SourceNeeded} from './errors.js';

export function normalizeSpeechTiming(result,{start,end}){
  if(!Array.isArray(result?.segments))throw new SourceNeeded('Local speech recognition returned no timed transcript.');
  const rows=[],outside=[];let pending=[];
  for(const row of result.segments){
    if(typeof row.text!=='string' || !row.text.trim())continue;
    if(!Number.isFinite(row.start) || !Number.isFinite(row.end))throw new SourceNeeded('Local speech recognition returned invalid timestamps.');
    if(row.start>=end || row.end<=start){outside.push(row);continue;}
    const a=Math.max(start,row.start),b=Math.min(end,row.end);
    if(b>a){rows.push({...row,start:a,end:b,text:[...pending,row.text.trim()].join(' '),...(pending.length || a!==row.start || b!==row.end?{endEstimated:true}:{})});pending=[];}
    else if(rows.length && row.end===row.start){rows.at(-1).text+=' '+row.text.trim();rows.at(-1).end=Math.max(rows.at(-1).end,a);rows.at(-1).endEstimated=true;}
    else if(!rows.length && row.end===row.start)pending.push(row.text.trim());
    else throw new SourceNeeded('Local speech recognition returned reversed timestamps.');
  }
  if(!rows.length)throw new SourceNeeded('Local speech recognition produced no speech aligned to this recording window.');
  if(pending.length)throw new SourceNeeded('Local speech could not be aligned to a timed cue.');
  return {...result,segments:rows,unalignedSegments:outside,timingNotes:outside.length?[`${outside.length} speech-recognition fragments fell outside the audio window. They remain in the local source cache and were excluded from the chapter.`]:[]};
}
