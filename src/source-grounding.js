import {screenExamples} from './screen-examples.js';

function distance(a,b){let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}return row[b.length];}

function groundTechnicalNames(chapter,evidence){
  const counts=new Map(),corrections=[],spoken=chapter.segments.map(s=>s.text).join('\n');
  for(const frame of evidence){
    if(!frame.image)continue;
    for(const name of new Set((frame.content || '').match(/\b[A-Z][a-zA-Z]{7,39}\b/g) || [])){
      if(!/[a-z][A-Z]/.test(name) && !/^[A-Z]{2,}[a-z]/.test(name))continue;
      // A second modality must already spell this exact technical name. OCR
      // alone can erase spaces inside literals ("Hello World" -> HelloWorld).
      if(!new RegExp('\\b'+name+'\\b','i').test(spoken))continue;
      const observations=counts.get(name) || [];observations.push(frame);counts.set(name,observations);
    }
  }
  const segments=chapter.segments.map(segment=>{
    if(/\b(?:misspell|typo|incorrect|deliberate|mistake)\w*\b/i.test(segment.text))return segment;
    const candidates=[...counts].filter(([,frames])=>frames.some(f=>f.at>=segment.start-25 && f.at<=segment.end+25));
    // Overlapping one- and two-word readings let "ECMO script" align with
    // repeated "ECMAScript" without a course-specific spelling dictionary.
    const matches=[...segment.text.matchAll(/(?=(\b[A-Za-z]{3,}(?:[ -][A-Za-z]{3,})?\b))/g)];
    let text=segment.text,rightBoundary=Infinity;
    for(const match of matches.reverse()){
      const before=match[1];if(match.index+before.length>rightBoundary)continue;
      const normalized=before.replace(/[ -]/g,'').toLowerCase();
      const supported=candidates.filter(([name])=>Math.abs(name.length-normalized.length)<=1 && distance(name.toLowerCase(),normalized)<=1);
      if(supported.length!==1 || before===supported[0][0])continue;
      const [after,frames]=supported[0];text=text.slice(0,match.index)+after+text.slice(match.index+before.length);rightBoundary=match.index;
      corrections.push({segment_id:segment.id,before,after,frameIds:frames.map(f=>f.id),reason:'Near-matching machine speech spelling aligned to an original screen and an existing exact spoken occurrence of the same technical name.'});
    }
    return text===segment.text?segment:{...segment,text};
  });
  return {chapter:{...chapter,segments},corrections};
}

function groundDeclarationKeywords(chapter,evidence){
  const corrections=[],segments=chapter.segments.map(segment=>{
    if(!/\bdeclar\w*\s+(?:a\s+)?variable\b/i.test(segment.text) || /\b(?:wrong|incorrect|typo|deliberate|mistake)\w*\b/i.test(segment.text))return segment;
    const counts=new Map();
    for(const frame of evidence.filter(f=>f.image && f.at>=segment.start && f.at<segment.end+2)){
      const code=(frame.content || '').normalize('NFKC');
      // OCR can join "var i" into "vari". Require actual for-loop syntax,
      // not a keyword incidentally mentioned in a toolbar or browser page.
      for(const keyword of new Set([...code.matchAll(/\bfor\s*\(\s*(var|let|const)\s*[A-Za-z_$][\w$]*\s*=/g)].map(m=>m[1]))){const ids=counts.get(keyword)||[];ids.push(frame.id);counts.set(keyword,ids);}
    }
    const supported=[...counts].filter(([,ids])=>new Set(ids).size>=2);
    if(supported.length!==1)return segment;
    const [after,frameIds]=supported[0];
    const text=segment.text.replace(/\b(with|using)\s+(the\s+)?([A-Za-z]+)\s+keyword\b/gi,(whole,verb,article,before)=>{
      if(/^(?:var|let|const|this|class|new|return|function|async|await|static|same|other|first|second)$/i.test(before))return whole;
      corrections.push({segment_id:segment.id,before,after,frameIds,reason:'Misheard declaration keyword resolved against the same for-loop declaration in multiple original screens.'});
      return `${verb} ${article || ''}${after} keyword`;
    });
    return text===segment.text?segment:{...segment,text};
  });return {chapter:{...chapter,segments},corrections};
}

function groundStringDelimiters(chapter,evidence){
  const corrections=[],segments=chapter.segments.map(segment=>{
    if(!/\b(?:single|double)\s+(?:code|coat)\b(?!\s+(?:unit|point))/i.test(segment.text))return segment;
    const readings=new Map();
    for(const frame of evidence.filter(f=>f.image && f.at>=segment.start-2 && f.at<segment.end+2)){
      for(const match of (frame.content || '').matchAll(/\b([A-Za-z_]\w*(?:\.\w+)*)\s*\(\s*(['"])[^\n]*?\2\s*[,)]/g)){
        if(!segment.text.includes(match[1]))continue;
        const ids=readings.get(match[2])||new Set();ids.add(frame.id);readings.set(match[2],ids);
      }
    }
    if(readings.size!==1)return segment;
    const [quote,ids]=[...readings][0];if(ids.size<2)return segment;
    const text=segment.text.replace(/\b(single|double)\s+(code|coat)\b(?!\s+(?:unit|point))/gi,(before,type)=>{
      if((type.toLowerCase()==='single')!==(quote==="'"))return before;
      const after=type+' quote';corrections.push({segment_id:segment.id,before,after,frameIds:[...ids],reason:'Misheard string delimiter resolved against matching quoted function arguments in multiple original screens.'});return after;
    });return text===segment.text?segment:{...segment,text};
  });return {chapter:{...chapter,segments},corrections};
}

function groundSpokenIdentifiers(chapter,evidence){
  const names=new Map(),corrections=[];
  for(const frame of evidence){
    if(!frame.image)continue;
    for(const name of new Set([...(frame.content || '').matchAll(/\b([A-Za-z]\w*_[A-Za-z]\w*)\s*=/g)].map(m=>m[1]))){const frames=names.get(name)||[];frames.push(frame);names.set(name,frames);}
  }
  const segments=chapter.segments.map(segment=>{
    if(!/\b(?:variable|identifier|named|called|assign|store)\w*\b/i.test(segment.text) || /\b(?:misspell|typo|incorrect|deliberate|mistake)\w*\b/i.test(segment.text))return segment;
    let text=segment.text;
    for(const [after,frames] of [...names].sort((a,b)=>b[0].length-a[0].length)){
      const nearby=frames.filter(f=>f.at>=segment.start-20 && f.at<segment.end+20);if(new Set(nearby.map(f=>f.id)).size<2)continue;
      const before=after.replaceAll('_',' '),pattern=new RegExp('\\b'+before.replaceAll(' ','\\s+')+'\\b','gi');
      text=text.replace(pattern,match=>{corrections.push({segment_id:segment.id,before:match,after,frameIds:nearby.map(f=>f.id),reason:'Spoken variable name aligned to the same underscore-separated assignment in multiple original screens.'});return after;});
    }
    return text===segment.text?segment:{...segment,text};
  });return {chapter:{...chapter,segments},corrections};
}

// Raw transcript rows stay intact; only the working source receives narrowly
// supported spelling corrections from repeated original screens.
export function groundSpeech(chapter,evidence){
  const identifiers=groundSpokenIdentifiers(chapter,evidence),punctuation=groundStringDelimiters(identifiers.chapter,evidence),keywords=groundDeclarationKeywords(punctuation.chapter,evidence),names=groundTechnicalNames(keywords.chapter,evidence);chapter=names.chapter;
  const observations=screenExamples(evidence),corrections=[...identifiers.corrections,...punctuation.corrections,...keywords.corrections,...names.corrections];
  const segments=chapter.segments.map(segment=>{
    if(!/\b(?:encod|decod)\w*/i.test(segment.text))return segment;
    if(!/\b(?:same|original)\s+(?:string|text)\b/i.test(segment.text) || /\b(?:wrong|incorrect|bug|mismatch|mistake|not\s+the\s+same|different\s+string)\b/i.test(segment.text))return segment;
    const nearby=new Set(evidence.filter(e=>e.at>=segment.start-20 && e.at<segment.end+22).map(e=>e.id));
    const examples=observations.filter(example=>example.frameIds.some(id=>nearby.has(id))),values=[...new Set(examples.map(example=>example.decoded))];
    if(values.length!==1 || !/^[A-Za-z]+(?: [A-Za-z]+){1,5}$/.test(values[0]) || values[0].length<6 || values[0].length>60)return segment;
    const expected=values[0],words=expected.split(' ').length;
    const pattern=new RegExp('(?=(\\b[A-Za-z][A-Za-z0-9_]*(?:\\s+[A-Za-z][A-Za-z0-9_]*){'+(words-1)+'}\\b))','g');
    let text=segment.text,rightBoundary=Infinity;
    for(const match of [...text.matchAll(pattern)].reverse()){
      const before=match[1],normalized=before.replace(/\s+/g,' ');
      if(match.index+before.length>rightBoundary)continue;
      if(normalized===expected || Math.abs(normalized.length-expected.length)>2 || distance(normalized.toLowerCase(),expected.toLowerCase())>2)continue;
      text=text.slice(0,match.index)+expected+text.slice(match.index+before.length);
      rightBoundary=match.index;
      corrections.push({segment_id:segment.id,before,after:expected,frameIds:[...new Set(examples.flatMap(e=>e.frameIds))],reason:'Near-matching machine speech spelling aligned to repeated decoded screen output.'});
    }
    return text===segment.text?segment:{...segment,text};
  });
  return {chapter:{...chapter,segments},corrections};
}

export function vocabularyClaims(text){
  const patterns=[/\b(?:vocabulary|codebook)(?:\s+(?:size|of|is|has|with|here|contains|uses|a|the)){0,5}\s*[:=]?\s*(\d[\d,]*)/gi,/\b(?:vocabulary|codebook)\b[^.!?;\n]{0,140}?\b(?:specifically|exactly)\s+(\d[\d,]*)/gi];
  return patterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>({start:match.index+match[0].length-match[1].length,end:match.index+match[0].length,number:Number(match[1].replaceAll(',','')),text:match[1]})));
}

// Bind a displayed entry count instead of describing its maximum ID as size.
// Integer range endpoints elsewhere in the paragraph remain unchanged.
export function groundDraftFacts(draft,examples,segments=[]){
  const counts=[...new Set(examples.map(e=>e.vocabSize).filter(Number.isSafeInteger))],corrections=[];
  if(counts.length!==1)return {draft,corrections};
  const expected=counts[0],sections=draft.sections.map(section=>{
    if(typeof section?.markdown!=='string')return section;
    if(segments.some(s=>section.segment_ids.includes(s.id) && /\b(?:wrong|incorrect|bug|mismatch|mistake|off.by.one)\b/i.test(s.text)))return section;
    let markdown=section.markdown;
    const claims=[...new Map(vocabularyClaims(markdown).filter(claim=>claim.number===expected-1).map(claim=>[claim.start,claim])).values()].sort((a,b)=>b.start-a.start);
    for(const claim of claims){const after=expected.toLocaleString('en-US');markdown=markdown.slice(0,claim.start)+after+markdown.slice(claim.end);corrections.push({segment_id:section.segment_ids[0],before:claim.text,after,frameIds:[...new Set(examples.filter(e=>e.vocabSize===expected).flatMap(e=>e.frameIds || []))],reason:'Displayed n_vocab is the entry count, not the maximum integer ID.'});}
    return markdown===section.markdown?section:{...section,markdown};
  });
  return {draft:{...draft,sections},corrections};
}
