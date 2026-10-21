import {MAX_BOOK_CHAPTERS} from '../public/course-bundle.js';
import { assert, SourceNeeded } from './errors.js';
import { ingestURL, officialCaptions, parseYouTubeURL } from './youtube.js';
import { parseTranscript, seconds, selectChapter, planChapters, navigationWindows } from './transcript.js';
import { normalizeEvidence, selectEvidence, planFrames } from './evidence.js';
import { generate } from './generation.js';
import { verify } from './verification.js';
import { renderMarkdown } from './markdown.js';
import { findPublishedSource, isPublisherURL, publisherCaptions, teachingBeats } from './publishers.js';
import { captureFrames, fetchPublisherVideo, readScreens } from './media.js';
import { discoverLocalModel } from './local-model.js';
import { combineChapters } from './book.js';

export async function runPipeline(input, { onStage = () => {}, onProgress = () => {}, onCheckpoint = async () => {}, resumeParts = [], env = process.env, fetcher = fetch, fixture = null, signal, sourceTools = null, mediaInput = null } = {}) {
  assert(input && typeof input === 'object', 'Supply a conversion request.');
  assert(input.access == null || input.access === 'publisher', 'This build processes source material locally. Cloud video access is disabled.');
  assert(!input.useModel || input.provider == null || input.provider === 'local', 'This build uses local writing only. Choose the local model.');
  const localSource = input.sourceType === 'local';
  const uploadedSource = input.sourceType === 'media';
  if(uploadedSource) assert(mediaInput?.path && sourceTools,'Upload a recording and install local source tools before converting it.');
  if (localSource) {
    assert(typeof input.title === 'string' && input.title.trim() && input.title.length <= 300, 'Give your local source a title.');
    assert(input.transcript, 'Import or paste a transcript, or choose Audio or video recording to transcribe a recording locally.');
  }
  const publisherURL = isPublisherURL(input.url);
  const start = seconds(input.start ?? (fixture || localSource || uploadedSource || publisherURL ? 0 : parseYouTubeURL(input.url).initialStart)), duration = Number(input.duration ?? 480);
  assert(Number.isFinite(start) && start >= 0 && start <= 85800, 'Choose a valid chapter start time.');
  assert([300, 480, 600].includes(duration), 'Choose a 5, 8, or 10 minute chapter.');
  onStage('ingestion');
  let source, warnings = [];
  if (fixture) source = fixture.source;
  else if (localSource) source = { id: 'local-import', kind: 'local-import', url: null, title: input.title.trim(), author: typeof input.author === 'string' ? input.author.slice(0, 200) : 'User-supplied recording', synthetic: false, metadataOrigin: 'User-supplied title; recording identity not authenticated' };
  else if(uploadedSource) source={id:mediaInput.id,kind:'local-media',mediaId:mediaInput.id,url:null,title:(input.title || mediaInput.title).slice(0,300),author:'User-supplied recording',synthetic:false,metadataOrigin:'Uploaded local media; recording identity is not authenticated'};
  else if (publisherURL) source = await findPublishedSource(input.url,{fetcher,signal});
  else ({ source, warnings } = await ingestURL(input.url, { fetcher }));
  onStage('transcript');
  let transcript = fixture?.segments || input.transcript;
  const mediaState={file:mediaInput?.path || null,hasVideo:true};
  const ensureVideo=async()=>{
    if(!mediaState.file){const downloaded=await sourceTools.video(source.id,{signal,onProgress});mediaState.file=downloaded.file;source.title=downloaded.title || source.title;source.author=downloaded.author || source.author;source.duration=downloaded.duration;}
    return mediaState.file;
  };
  let fetchedEvidence = [];
  let provenance = fixture ? fixture.provenance : localSource ? 'User-supplied transcript of a local recording; recording identity, completeness and visual alignment are not independently verified.' : 'User-supplied transcript and visual evidence; source alignment not independently verified';
  if (!transcript || (typeof transcript === 'string' && !transcript.trim())) {
    if (!source.captionsURL && !env.YOUTUBE_ACCESS_TOKEN) {
      onProgress({message:'Checking creator-published source downloads'});
      try { source = await findPublishedSource(input.url,{fetcher,signal,youtubeId:source.id}) || source; }
      catch { signal?.throwIfAborted(); }
    }
    let downloaded;
    if(source.captionsURL) downloaded=await publisherCaptions(source,{fetcher,signal});
    else if(!uploadedSource && sourceTools && !env.YOUTUBE_ACCESS_TOKEN){
      try{onProgress({message:'Reading public YouTube captions locally'});downloaded=await sourceTools.captions(source.id,{signal,onProgress});source.publicYouTube=true;}
      catch(error){signal?.throwIfAborted();warnings.push(error.message);}
    }else if(!uploadedSource)downloaded=await officialCaptions(source.id,{token:env.YOUTUBE_ACCESS_TOKEN,fetcher});
    if(downloaded){
      transcript=downloaded.segments || downloaded.text;provenance=downloaded.origin;
      if(downloaded.isGenerated || source.publicYouTube){
        // A manually supplied YouTube track can still contain speech-recognition
        // errors. Its metadata is not a quality guarantee for programming text.
        source.machineTranscript=true;source.transcriptionOrigin=downloaded.isGenerated?'YouTube automatic captions':'Public YouTube captions (unverified)';
        if(sourceTools?.video && sourceTools?.probe && sourceTools?.transcribe){
          try{
            const file=await ensureVideo(),metadata=await sourceTools.probe(file,{signal,onProgress});mediaState.hasVideo=metadata.hasVideo;source.duration=metadata.duration;
            assert(metadata.hasAudio,'The public recording has no readable audio track.');
            const speechStart=input.scope==='full-video'?0:Math.max(0,start-10),speechEnd=input.scope==='full-video'?metadata.duration:Math.min(start+duration+15,metadata.duration);
            assert(speechEnd>speechStart && speechEnd<=(input.scope==='full-video'?duration*MAX_BOOK_CHAPTERS:86400),'The recording exceeds the local transcription limit.');
            onProgress({message:'Transcribing audio locally for a complete speech source'});
            const spoken=await sourceTools.transcribe(file,{start:speechStart,end:speechEnd,signal,onProgress});
            if(!spoken.segments?.length)throw new Error('Local speech recognition returned no source text.');
            parseTranscript(spoken.segments);warnings.push(...(spoken.timingNotes || []));
            transcript=spoken.segments;provenance=spoken.origin;source.transcriptionOrigin='Local Whisper speech recognition';
            warnings.push('Local speech transcription was used in place of the public YouTube captions. The original public caption track is cached on this device; both sources can contain recognition errors.');
          }catch(error){signal?.throwIfAborted();warnings.push('Local audio checking was unavailable. Unverified public YouTube captions are being used; programming terms and numbers may be misrecognized.');}
        }
      }
    }
    else if(sourceTools){
      let file;
      try{file=await ensureVideo();}catch(error){signal?.throwIfAborted();throw new SourceNeeded(`${warnings.join(' ')} ${error.message} No source was recovered. You can upload the recording for local transcription.`.trim());}
      const metadata=await sourceTools.probe(file,{signal,onProgress});mediaState.hasVideo=metadata.hasVideo;
      assert(metadata.hasAudio,'This recording has no readable audio track.');
      source.duration=metadata.duration;
      const end=input.scope==='full-video' ? metadata.duration : Math.min(start+duration,metadata.duration);
      assert(Number.isFinite(end) && end>start && end<=(input.scope==='full-video'?duration*MAX_BOOK_CHAPTERS:86400),'The selected recording window is empty or exceeds the 96-chapter limit.');
      onProgress({message:'Transcribing speech on this device'});
      downloaded=await sourceTools.transcribe(file,{start:input.scope==='full-video'?0:start,end,signal,onProgress});
      transcript=downloaded.segments;provenance=downloaded.origin;warnings.push(...(downloaded.timingNotes || []));source.machineTranscript=true;source.transcriptionOrigin='Local Whisper speech recognition';
      if(!uploadedSource)source.publicYouTube=true;
    }
  }
  const segments = source.captionsURL || source.publicYouTube || source.machineTranscript ? teachingBeats(parseTranscript(transcript)) : parseTranscript(transcript);
  onStage('chapter-planning');
  assert(input.scope == null || ['chapter','full-video'].includes(input.scope), 'Choose one chapter or the full video.');
  if (input.scope === 'full-video') {
    const plan = planChapters(segments,duration);
    assert(plan.length <= MAX_BOOK_CHAPTERS, 'A full-video run supports at most 96 chapters; choose a longer chapter window for a longer recording.');
    const completed = [];
    for (let i = 0; i < plan.length; i++) {
      signal?.throwIfAborted();
      const item = plan[i], rows = segments.filter(s=>item.segmentIds.includes(s.id));
      const chapter = {start:rows[0].start,end:Math.max(...rows.map(s=>s.end)),actualStart:rows[0].start,actualEnd:Math.max(...rows.map(s=>s.end)),segments:rows,planned:true};
      const saved = resumeParts[i];
      if (saved && saved.source.id === source.id && JSON.stringify(saved.chapter.segments) === JSON.stringify(rows) && !saved.generated.generationFailed) { completed.push(saved); onProgress({message:`Restored completed chapter ${i+1}/${plan.length}`,chapter:i+1,chapters:plan.length}); continue; }
      onProgress({message:`Chapter ${i+1} of ${plan.length}`,chapter:i+1,chapters:plan.length});
      const part = await writeChapter(chapter,plan,{...input,scope:'chapter'},{source,warnings,provenance,fixture,fetchedEvidence,env,fetcher,signal,onStage,mediaState,ensureVideo,sourceTools,onProgress:progress=>onProgress({...progress,message:`Chapter ${i+1}/${plan.length}: ${progress.message || 'writing'}`,chapter:i+1,chapters:plan.length})});
      completed.push(part);
      if (part.generated.generationFailed) throw new SourceNeeded(`Chapter ${i+1} writing failed: ${part.generated.warnings[0]} No complete book was accepted. Completed earlier chapters are saved for retry.`);
      await onCheckpoint(completed);
    }
    return combineChapters(completed);
  }
  const chapter = selectChapter(segments, start, duration);
  const chapters = navigationWindows(segments,duration,source);
  return writeChapter(chapter,chapters,input,{source,warnings,provenance,fixture,fetchedEvidence,env,fetcher,signal,onStage,onProgress,mediaState,ensureVideo,sourceTools});
}
async function writeChapter(chapter,chapters,input,{source,warnings,provenance,fixture,fetchedEvidence=[],env,fetcher,signal,onStage,onProgress,mediaState,ensureVideo,sourceTools}) {
  onStage('visual-evidence');
  const boundToRecording=()=>{if(Number.isFinite(source.duration) && source.duration>chapter.start && source.duration<chapter.end){chapter.end=source.duration;chapter.planned=true;}};
  boundToRecording();
  let suppliedEvidence = fixture?.evidence || (input.evidence?.length ? input.evidence : fetchedEvidence);
  let visualFailure=null;
  if((source.publicYouTube || mediaState?.file) && input.visuals!==false && !suppliedEvidence.length && mediaState?.hasVideo!==false){
    try{await ensureVideo();}catch(error){signal?.throwIfAborted();visualFailure=error.message;}
  }
  if ((source.mediaURL || mediaState?.file && mediaState.hasVideo!==false) && input.visuals !== false && !suppliedEvidence.length) {
    boundToRecording();
    const local = await discoverLocalModel({fetcher,env});
    const file = mediaState?.file || await fetchPublisherVideo(source.mediaURL,{fetcher,signal,onProgress});
    if(!Number.isFinite(source.duration) && sourceTools?.probe){const metadata=await sourceTools.probe(file,{signal,onProgress});source.duration=metadata.duration;boundToRecording();}
    onProgress({message:'Extracting measured video frames'});
    const captured = await captureFrames(file,{...chapter,start:Math.min(chapter.start,chapter.actualStart),end:Math.min(Math.max(chapter.end,chapter.actualEnd),source.duration || Infinity)},{env,signal,sourceLabel:source.kind==='local-media'?'uploaded recording':source.publicYouTube?'public YouTube video':'publisher-linked video'});
    suppliedEvidence = await readScreens(captured,{fetcher,env,signal,model:local.model,onProgress,sourceTools,chapter});
    if(!local.available)warnings.push('The local writing/vision model is offline. Captured images and available local OCR are retained; no hosted model was called.');
  }
  const allEvidence = normalizeEvidence(suppliedEvidence);
  const evidence = selectEvidence(allEvidence, chapter);
  const framePlan = planFrames(chapter, evidence);
  onStage('generation');
  signal?.throwIfAborted();
  const generated = await generate(chapter, evidence, { useModel: input.useModel === true, provider: input.provider || 'local', env, fetcher, signal, onProgress,machineTranscript:source.machineTranscript===true });
  signal?.throwIfAborted();
  generated.warnings.unshift(...warnings);
  if(visualFailure)generated.warnings.unshift(`Video screens could not be recovered: ${visualFailure} This result cannot fulfill the visual/code-preservation requirement.`);
  if(source.machineTranscript)generated.warnings.push(`${source.transcriptionOrigin || 'Machine speech recognition'} supplied this transcript. Recognition errors, missing quiet speech and approximate timing can change programming details. Compare code against the retained images and recording.`);
  if(mediaState?.hasVideo===false)generated.warnings.push('Audio-only source: unspoken code, diagrams and terminal states are unavailable.');
  if (source.license) generated.warnings.unshift(`${source.license.attribution} ${source.license.name}: ${source.license.url}. ${source.license.notice}`);
  if (source.mediaURL || mediaState?.file && mediaState.hasVideo!==false) generated.warnings.push(input.visuals === false ? 'Screen extraction was disabled. This transcript-only result cannot preserve unspoken code/visual details.' : 'Frames were sampled at 15-second intervals. Local vision text may be wrong and brief intermediate code/terminal states may fall between captures. Inspect the retained frames.');
  if (allEvidence.length > evidence.length) generated.warnings.push(`${allEvidence.length - evidence.length} visual record(s) lie outside this chapter window and are not included in this chapter.`);
  onStage('verification');
  const report = verify(chapter, evidence, framePlan, generated);
  const result = { schemaVersion: 1, source, provenance, chapter, chapterPlan: chapters, evidence, framePlan, generated, report,
    windowLength:Number(input.duration || 480), conversionScope: 'one-chapter', createdAt: new Date().toISOString() };
  result.markdown = renderMarkdown(result);
  return result;
}
