const LOCAL_URL = 'http://127.0.0.1:11434';
import {screenExamples} from './screen-examples.js';
import {groundDraftFacts} from './source-grounding.js';

export function screenIdentifiers(frames){
  const counts=new Map();
  for(const frame of frames){
    if(!frame.image)continue;
    const code=(frame.content || '').replace(/"[^"\n]*"|'[^'\n]*'/g,'');
    const tokens=new Set(code.match(/\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\b/g) || []);
    for(const token of tokens){
      const keyword=/^(?:var|let|const|this|def|return|tiktoken|torch|stoi|itos|encode|decode|SentencePiece)$/.test(token);
      const identifier=/[a-z]_[a-z]|[a-z][A-Z]|\w\.\w/.test(token) && new RegExp('\\b'+token.replaceAll('.','\\.')+'\\s*(?:[=(\\[]|\\.)').test(code);
      if(token.length<=60 && (keyword || identifier))counts.set(token,(counts.get(token)||0)+1);
    }
  }
  return [...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).slice(0,40).map(([token])=>token);
}

export async function discoverLocalModel({ fetcher = fetch, env = process.env } = {}) {
  try {
    const response = await fetcher(`${LOCAL_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { available: false, models: [], reason: 'Ollama did not respond successfully.' };
    const data = await response.json();
    const models = (data.models || []).filter(row=>!row.remote_host && !row.remote_model).map(m => m.name).filter(n => typeof n === 'string' && !/(?:^|[-:])cloud(?:$|[-:])/i.test(n));
    const preferred = env.OLLAMA_MODEL || models.find(n=>/^qwen3\.5:9b$/.test(n)) || models.find(n => /64k/.test(n)) || models[0];
    if (!preferred || !models.includes(preferred)) return { available: false, models, reason: 'No matching downloaded local model was found.' };
    const selected=(data.models || []).find(row=>row.name===preferred);
    const vision=selected?.capabilities?.includes('vision') || selected?.details?.families?.includes('qwen35') || selected?.details?.family==='qwen35';
    return { available: true, models, model: preferred,vision:Boolean(vision), provider: 'ollama', endpoint: LOCAL_URL };
  } catch { return { available: false, models: [], reason: 'No local Ollama service was reachable.' }; }
}

export function batchSegments(segments, targetChars = 12000, evidence = []) {
  const batches = []; let current = [], length = 0;
  for (const segment of segments) {
    const cost = JSON.stringify(segment).length + evidence.filter(e=>e.at >= segment.start && e.at < segment.end).reduce((sum,{image,...event})=>sum+JSON.stringify(event).length,0);
    if (current.length && length + cost > targetChars) { batches.push(current); current = []; length = 0; }
    current.push(segment); length += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}
export async function generateLocally(chapter, evidence, schema, instructions, { fetcher = fetch, env = process.env, signal, onProgress = () => {}, validate = null,contextSegments=chapter.segments,repairDraft=[] } = {}) {
  signal?.throwIfAborted();
  const local = await discoverLocalModel({ fetcher, env });
  if (!local.available) throw new Error('local_model_unavailable');
  // A teaching beat has one writing request. Keeping its comparisons and code
  // setup together avoids hiding omissions behind a chapter-wide coverage score.
  const batches = chapter.segments.map(segment=>[segment]), sections = [], retained=[],examplesUsed=[],observations=screenExamples(evidence),factCorrections=[];
  let title = '';
  for (let index = 0; index < batches.length; index++) {
    signal?.throwIfAborted();
    onProgress({ completed: index, total: batches.length, message: `Writing part ${index + 1} of ${batches.length}` });
    const segments = batches[index];
    const partSchema = structuredClone(schema);
    const ids = segments.map(s=>s.id);
    if (partSchema?.properties?.sections?.items?.properties?.segment_ids) {
      partSchema.properties.sections.minItems = ids.length;
      partSchema.properties.sections.maxItems = ids.length;
      partSchema.properties.sections.items.properties.segment_ids = {type:'array',minItems:1,maxItems:1,items:{type:'string',enum:ids}};
    }
    const partStart = index === 0 ? Math.min(chapter.start,segments[0].start) : segments[0].start;
    const partEnd = Math.min(batches[index+1]?.[0].start ?? Math.max(chapter.end,segments.at(-1).end),segments.at(-1).end+2);
    const nearby=evidence.filter(e=>e.at>=partStart && e.at<partEnd),nearbyIds=new Set(evidence.filter(e=>e.at>=partStart-20 && e.at<partEnd+20).map(e=>e.id)),examples=observations.filter(example=>example.frameIds.some(id=>nearbyIds.has(id)));
    for(const example of examples)if(!examplesUsed.some(e=>e.decoded===example.decoded && JSON.stringify(e.encoded)===JSON.stringify(example.encoded)))examplesUsed.push({...example,segment_id:segments[0].id});
    const contextIndex=contextSegments.findIndex(row=>row.id===segments[0].id);
    const before=contextIndex>=0?contextSegments[contextIndex-1]:null,after=contextIndex>=0?contextSegments[contextIndex+1]:null;
    const previousTail=before?.text.split(/(?<=[.!?])\s+/).at(-1).slice(-120);
    const nextOpening=after && !/[.!?]$/.test(segments.at(-1).text.trim()) ? (after.text.match(/^.*?[.!?](?=\s|$)/s)?.[0] || after.text.slice(0,120)).slice(0,120) : null;
    const contextSources=[previousTail && {boundary:'previous ending',text:previousTail},nextOpening && {boundary:'next opening',text:nextOpening}].filter(Boolean);
    const message = { role: 'user', content: JSON.stringify({ boundary_context:contextSources, screen_examples:examples,screen_identifiers:screenIdentifiers(nearby),required_segment_ids:ids, instruction:'Rewrite only the following source passage into a written lesson. Boundary context resolves unfinished sentences; never repeat earlier teaching. screen_examples are repeated machine readings that will be printed as exact example boxes beside your prose. Refer to the displayed example instead of retyping its input or integer list. Explain every reasoning step around it. All original screens and code are inserted separately. Preserve all of this spoken passage.',segments }) };
    const existing=repairDraft.find(section=>section.segment_ids.includes(ids[0]));
    if(existing){const payload=JSON.parse(message.content);payload.existing_passage=existing;payload.instruction='Edit existing_passage only to correct the specific supported review findings. Preserve all its other correct teaching and examples. Do not regenerate a different lesson. Compare with segments, and return the corrected section using its original source ID.';message.content=JSON.stringify(payload);}
    if (message.content.length > 50000) throw new Error('local_context_too_large');
    let partial=null,lastError;
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const response=await fetcher(`${LOCAL_URL}/api/chat`,{
          method:'POST',headers:{'Content-Type':'application/json'},signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000),
          body:JSON.stringify({model:local.model,stream:false,think:false,format:partSchema,keep_alive:index===batches.length-1 ? 0 : '5m',
            messages:[{role:'system',content:instructions+'\nReturn exactly one section per supplied source segment ID, in required_segment_ids order. Never use visual IDs as source IDs. Write only the spoken passage in segments, using references to the displayed screen_examples. Their exact literals and numeric sequences are rendered separately; do not retype them in prose. Do not invent the rest of a visible code cell or README. '+(attempt ? 'The previous response failed validation ('+lastError?.message+'). Edit only the supplied speech; do not add background. Keep prose within '+Math.ceil(segments[0].text.length*1.3)+' characters. Return valid complete JSON sections; no code fences, omitted IDs, compressed summary, or repeated earlier passage. '+(['character_example_mismatch','screen_example_mismatch'].includes(lastError?.message)?'Your quoted input conflicts with its encoded output. Use the exact string paired with the integers in screen_examples.':lastError?.message==='screen_vocabulary_off_by_one'?'Use the exact visible n_vocab count in screen_examples; do not confuse the largest integer ID with the number of vocabulary entries.':'') : '')},message],
            options:{temperature:.2,presence_penalty:0,num_ctx:16384,num_predict:2048}})
        });
        if(!response.ok)throw new Error('local_model_failed');
        const data=await response.json();
        if(!data.done || data.done_reason==='length' || typeof data.message?.content!=='string')throw new Error('local_model_incomplete');
        let candidate=JSON.parse(data.message.content);
        if(!Array.isArray(candidate.sections))throw new Error('local_model_invalid');
        const actual=candidate.sections.flatMap(section=>section.segment_ids || []);
        if(actual.length!==ids.length || actual.some((id,i)=>id!==ids[i]))throw new Error('local_model_coverage');
        const grounded=groundDraftFacts(candidate,examples,segments);candidate=grounded.draft;
        if(validate)validate(candidate,segments,examples);
        const shingles=text=>{const words=text.toLowerCase().match(/[a-z0-9]+/g)||[];return new Set(words.slice(0,-4).map((_,i)=>words.slice(i,i+5).join(' ')));};
        const current=shingles(candidate.sections.map(s=>s.markdown).join(' '));
        if(current.size>20 && sections.some(section=>{const prior=shingles(section.markdown),shared=[...current].filter(s=>prior.has(s)).length;return shared/current.size>.55;}))throw new Error('repeated_previous_passage');
        partial=candidate;factCorrections.push(...grounded.corrections);break;
      }catch(error){
        signal?.throwIfAborted();lastError=error;
        if(error.message==='local_model_failed' || error.name==='TypeError')throw error;
      }
    }
    if(!partial){
      retained.push(...ids);
      partial={title:'A source-preserving written edition',sections:segments.map(row=>({heading:`Original explanation: Step ${index+1}`,segment_ids:[row.id],markdown:row.text,uncertainties:['Original wording retained because this passage did not pass local writing validation.']}))};
    }
    title ||= partial.title;sections.push(...partial.sections);
    onProgress({ completed: index + 1, total: batches.length, message: `Wrote part ${index + 1} of ${batches.length}` });
  }
  if(retained.length===chapter.segments.length)throw new Error('local_model_invalid');
  return { draft: { title, sections }, model: local.model,vision:local.vision,retained,screenExamples:examplesUsed,factCorrections,inspectedFrameIds:[],
    warnings: evidence.some(e => e.image) ? ['Prose was written from the spoken source and repeated screen examples. Original frames remain available for separate source review. Machine readings and model review can still be wrong.'] : [] };
}
