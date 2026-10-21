import { assert, SourceNeeded } from './errors.js';

export const KARPATHY_ID = 'kCc8FmEb1nY';
export function parseYouTubeURL(value) {
  let url;
  const raw = typeof value === 'string' ? value.trim() : '';
  try { url = new URL(/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(raw) ? `https://${raw}` : raw); } catch { assert(false, 'Enter a complete YouTube URL.'); }
  assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port,
    'Use a standard YouTube URL without credentials or a custom port.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)\/?$/)?.[1];
  }
  assert(typeof id === 'string' && /^[\w-]{11}$/.test(id), 'Use a YouTube video link, not a playlist or another website.');
  const stamp = url.searchParams.get('t') || url.searchParams.get('start') || url.hash.replace(/^#t=/, '');
  let initialStart = 0;
  if (/^\d+s?$/.test(stamp)) initialStart = Number(stamp.replace(/s$/, ''));
  else if (/^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(stamp) && stamp) initialStart = Number(stamp.match(/(\d+)h/)?.[1] || 0) * 3600 + Number(stamp.match(/(\d+)m/)?.[1] || 0) * 60 + Number(stamp.match(/(\d+)s/)?.[1] || 0);
  return { id, url: `https://www.youtube.com/watch?v=${id}`, initialStart };
}
export function timestampURL(source, seconds) {
  return source.url ? `${source.url}&t=${Math.floor(seconds)}s` : null;
}
export async function ingestURL(value, { fetcher = fetch } = {}) {
  const source = parseYouTubeURL(value);
  source.title = source.id === KARPATHY_ID ? "Let's build GPT: from scratch, in code, spelled out." : `YouTube tutorial Â· ${source.id}`;
  source.author = source.id === KARPATHY_ID ? 'Andrej Karpathy' : 'Creator not retrieved';
  source.metadataOrigin = source.id === KARPATHY_ID ? 'User-provided video reference' : 'Video URL';
  if(source.id===KARPATHY_ID)source.relatedCode={title:'Creator lecture code',url:'https://github.com/karpathy/ng-video-lecture',license:'MIT, for the repository code only; not the video narration'};
  const warnings = [];
  try {
    const response = await fetcher(`https://www.youtube.com/oembed?url=${encodeURIComponent(source.url)}&format=json`, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) throw new Error();
    const metadata = await response.json();
    if (typeof metadata.title === 'string') source.title = metadata.title.slice(0, 300);
    if (typeof metadata.author_name === 'string') source.author = metadata.author_name.slice(0, 200);
    source.metadataOrigin = 'YouTube oEmbed';
  } catch { warnings.push('Video metadata could not be retrieved. The URL is retained; this does not establish access to captions or video.'); }
  return { source, warnings };
}
export async function officialCaptions(videoId, { token = process.env.YOUTUBE_ACCESS_TOKEN, fetcher = fetch } = {}) {
  if (!token) throw new SourceNeeded('Captions are needed. This app cannot currently fetch captions for this video. Its YouTube Data API connector requires editing access; no token is configured. Import timestamped transcript text to continue. This is an app integration limitation.');
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const listing = await fetcher(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${videoId}`, { headers, signal: AbortSignal.timeout(15000) });
    if (!listing.ok) throw new SourceNeeded(`YouTube caption access was unavailable (HTTP ${listing.status}). Import captions you are authorized to use.`);
    const { items = [] } = await listing.json();
    const available = items.filter(item => item.snippet?.status === 'serving' && !item.snippet?.isDraft);
    const track = available.find(item => item.snippet?.language === 'en') || available[0];
    if (!track) throw new SourceNeeded('No accessible caption track was found. Import a timestamped transcript.');
    const response = await fetcher(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}?tfmt=vtt`, { headers, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new SourceNeeded(`Caption download was unavailable (HTTP ${response.status}). Import an authorized transcript instead.`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2_000_000) throw new SourceNeeded('Caption track exceeds the local import limit of 2 MB. Import a smaller excerpt.');
    return { text, origin: `YouTube authorized captions (${track.snippet.language})` };
  } catch (error) {
    if (error instanceof SourceNeeded) throw error;
    throw new SourceNeeded('The YouTube caption service could not be reached. Import an authorized transcript instead.');
  }
}
