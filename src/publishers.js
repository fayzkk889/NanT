import { SourceNeeded, assert } from './errors.js';
import { parseTranscript } from './transcript.js';
import {readFile} from 'node:fs/promises';
const ROOT = 'https://ocw.mit.edu';
const publisherIndex=JSON.parse(await readFile(new URL('../data/publishers.json',import.meta.url),'utf8'));
const LICENSE = 'https://creativecommons.org/licenses/by-nc-sa/4.0/';
const decode = s => s.replace(/&amp;/g, '&').replace(/&#34;/g, '"').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/<[^>]*>/g, '').trim();
const pageCache = new Map();
async function textAt(url, fetcher, signal, max = 3_000_000) {
  let response;
  for (let attempt=0; attempt<2; attempt++) {
    try { response=await fetcher(url, {signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), redirect:'error'}); break; }
    catch { signal?.throwIfAborted(); if (attempt) throw new SourceNeeded('The publisher could not be reached after a retry. Your input is retained; retry when the connection is available.'); }
  }
  if (!response.ok) throw new SourceNeeded(`The publisher could not supply this source (HTTP ${response.status}). Retry later or use an authorized import.`);
  if (Number(response.headers?.get('content-length')) > max) throw new SourceNeeded('Publisher source exceeds the supported size.');
  const text = await response.text();
  assert(Buffer.byteLength(text) <= max, 'Publisher source exceeds the supported size.');
  return text;
}
export function parsePublisherPage(html, pageURL) {
  const url = new URL(pageURL);
  assert(url.protocol === 'https:' && url.hostname === 'ocw.mit.edu' && url.pathname.startsWith('/courses/'), 'Use an MIT OpenCourseWare lecture resource URL.');
  const id = html.match(/youtube\.com\/embed\/([\w-]{11})/)?.[1];
  const track = html.match(/<track\b[^>]*\bsrc="([^"]+\.vtt)"/i)?.[1];
  const media = html.match(/data-downloadlink\s*=\s*"([^"]+)"/)?.[1];
  assert(id && track, 'This publisher page does not expose a supported video and caption track.');
  const captionsURL = new URL(decode(track), url).href;
  assert(new URL(captionsURL).origin === ROOT, 'Publisher captions must come from MIT OpenCourseWare.');
  const mediaURL = media ? decode(media) : null;
  if (mediaURL) assert(/^https:\/\/archive\.org\/download\/[^?#]+\.mp4$/.test(mediaURL), 'Unrecognized publisher download URL.');
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || 'MIT OpenCourseWare lecture').split('|')[0].trim();
  return {id, url:`https://www.youtube.com/watch?v=${id}`, kind:'publisher', publisherURL:url.href, captionsURL, mediaURL, title, author:'MIT OpenCourseWare', synthetic:false,
    license: {name:'CC BY-NC-SA 4.0', url:LICENSE, attribution:`${title}. MIT OpenCourseWare.`, notice:'Adapted into written prose and selected frames. Noncommercial use; share adaptations under CC BY-NC-SA 4.0. No MIT endorsement.', termsURL:`${ROOT}/pages/privacy-and-terms-of-use/`}};
}
async function loadPage(url, fetcher, signal) {
  assert(isPublisherURL(url),'Use an HTTPS MIT OpenCourseWare lecture link without credentials or a custom port.');
  if (pageCache.has(url)) return pageCache.get(url);
  const page = parsePublisherPage(await textAt(url,fetcher,signal),url);
  pageCache.set(url,page); return page;
}
export function isPublisherURL(value) { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'ocw.mit.edu' && !u.port && !u.username && !u.password && u.pathname.startsWith('/courses/'); } catch { return false; } }
export async function findPublishedSource(value, {fetcher = fetch, signal, youtubeId} = {}) {
  if (isPublisherURL(value)) return loadPage(value, fetcher, signal);
  if (!youtubeId) return null;
  for (const page of pageCache.values()) if (page.id === youtubeId) return page;
  // The index records publisher-owned URLs, not copied captions. Fetch only a
  // matching source; unsupported videos do not trigger an unrelated crawl.
  return publisherIndex[youtubeId] ? loadPage(publisherIndex[youtubeId],fetcher,signal) : null;
}
export async function publisherCaptions(source, {fetcher = fetch, signal} = {}) {
  const text = await textAt(source.captionsURL,fetcher,signal,2_000_000);
  return {segments:parseTranscript(text), text, origin:`Publisher-provided timestamped captions: ${source.captionsURL}. ${source.license.attribution} ${source.license.name}. ${source.license.notice}`};
}
export function teachingBeats(segments) {
  const beats = [];
  // Recognition cues often end mid-sentence despite containing punctuation
  // internally. Split at sentence punctuation before grouping. Sub-cue times
  // are proportional estimates, explicitly retained as such in the report.
  const sentences=segments.flatMap(segment=>{
    const parts=segment.text.split(/(?<=[.!?])\s+(?=[A-Z"'`])/);
    if(parts.length===1)return [segment];
    let offset=0;
    return parts.map((text,index)=>{const start=segment.start+(segment.end-segment.start)*offset/segment.text.length;offset+=text.length;const end=index===parts.length-1?segment.end:segment.start+(segment.end-segment.start)*offset/segment.text.length;offset++;return {...segment,start,end,text,endEstimated:true};});
  });
  for (const segment of sentences) {
    const previous = beats.at(-1);
    // Keep a spoken sentence together rather than cutting its reasoning mid-way.
    const completeBeat = previous && previous.end-previous.start>=25 && /[.!?]["')\]]?\s*$/.test(previous.text);
    if (previous && !completeBeat && segment.start - previous.end < 2 && previous.text.length < 1100 && segment.end - previous.start <= 60) {
      previous.text += ` ${segment.text}`; previous.end = Math.max(previous.end,segment.end);if(segment.endEstimated)previous.endEstimated=true;
    } else beats.push({...segment});
  }
  return parseTranscript(beats);
}
