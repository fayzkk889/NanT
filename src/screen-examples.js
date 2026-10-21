// A narrow, inspectable anchor for codec demonstrations. These are repeated
// machine readings, not proof that arbitrary screen/code interpretation is right.
export function screenExamples(frames){
  const observations=new Map();
  for(const [index,frame] of frames.entries()){
    if(!frame.image || !/\bencode\b/i.test(frame.content) || !/\bdecode\b/i.test(frame.content))continue;
    const lines=frame.content.normalize('NFKC').replace(/[“”]/g,'"').replace(/[‘’]/g,"'").split('\n').map(line=>line.trim()).filter(Boolean);
    const arrays=[...new Map(lines.flatMap(line=>{
      const match=line.match(/^[\[(]\s*(\d+(?:\s*,\s*\d+){1,})\s*[\])]\s*$/);
      if(!match)return [];const values=match[1].split(',').map(Number);
      return values.length<=128 && values.every(Number.isSafeInteger)?[[JSON.stringify(values),values]]:[];
    })).values()];
    if(arrays.length!==1)continue;
    const decoded=new Set();
    for(let at=0;at<lines.length;at++){
      if(!/\bdecode\s*\(/i.test(lines[at]))continue;
      for(const line of lines.slice(at+1,at+6)){
        const quoted=line.match(/^["']([^"'\n]{1,120})["']$/);
        if(quoted){decoded.add(quoted[1]);break;}
        if(/^[A-Za-z0-9][A-Za-z0-9 .,!?_\-]{0,119}$/.test(line)){decoded.add(line);break;}
      }
    }
    if(decoded.size!==1)continue;
    const value=[...decoded][0],encoded=arrays[0];
    if(/\bstoi\b/.test(frame.content) && /\bitos\b/.test(frame.content) && [...value].length!==encoded.length)continue;
    const key=JSON.stringify([value,encoded]),record=observations.get(key)||{decoded:value,encoded,frameIds:[],at:frame.at,vocabReadings:[]};
    const property=lines.findIndex(line=>/\bn_vocab\b/.test(line));
    if(property>=0){const number=lines.slice(property+1,property+3).find(line=>/^\d+$/.test(line));if(number && Number.isSafeInteger(Number(number)))record.vocabReadings.push(Number(number));}
    record.frameIds.push(frame.id || `frame-${index+1}`);observations.set(key,record);
  }
  return [...observations.values()].filter(record=>new Set(record.frameIds).size>=2).slice(0,20).map(({vocabReadings,...record})=>{
    const values=[...new Set(vocabReadings)].filter(value=>vocabReadings.filter(n=>n===value).length>=2);
    return {...record,...(values.length===1?{vocabSize:values[0]}:{})};
  });
}

export function usableExamples(examples,segments){
  return (Array.isArray(examples)?examples:[]).slice(0,1200).filter(e=>e && typeof e.decoded==='string' && e.decoded.length<=120 && Array.isArray(e.encoded) && e.encoded.length<=128 && e.encoded.every(Number.isSafeInteger) && Number.isFinite(e.at) && e.at>=0 && e.at<=86400 && segments.some(s=>s.id===e.segment_id));
}
export function exampleText(example){
  return `Observed integer sequence: ${JSON.stringify(example.encoded)}\nDecoded text: ${JSON.stringify(example.decoded)}${Number.isSafeInteger(example.vocabSize)?`\nVisible n_vocab: ${example.vocabSize}`:''}`;
}
