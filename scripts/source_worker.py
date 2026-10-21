"""Local source adapters. One bounded JSON request on stdin; JSON result on stdout."""
import json, os, re, sys, tempfile, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / '.tools/source-python'))
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
os.environ.setdefault('HF_HUB_DISABLE_SYMLINKS_WARNING', '1')

def progress(message):
    print(json.dumps({'message': message}), file=sys.stderr, flush=True)

def video_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[\w-]{11}', value):
        raise ValueError('Invalid video ID')
    return value

def captions(data):
    from youtube_transcript_api import YouTubeTranscriptApi
    from requests import Session
    session = Session()
    session.trust_env = False
    original_request = session.request
    def bounded_request(*args, **kwargs):
        kwargs.setdefault('timeout', 15)
        return original_request(*args, **kwargs)
    session.request = bounded_request
    transcript = YouTubeTranscriptApi(http_client=session).fetch(video_id(data['id']), languages=['en', 'en-US', 'en-GB'])
    rows = [{'start': row.start, 'end': row.start + row.duration, 'text': row.text} for row in transcript if row.text.strip()]
    return {'segments': rows, 'language': transcript.language_code, 'isGenerated': transcript.is_generated,
            'origin': 'Public YouTube captions retrieved locally; unofficial connector. ' + ('YouTube automatic captions; may contain recognition errors.' if transcript.is_generated else 'Caption track as supplied by YouTube; source accuracy is not independently checked.')}

def download_video(data):
    from yt_dlp import YoutubeDL
    ident = video_id(data['id'])
    folder = ROOT / '.local-data/youtube' / ident
    folder.mkdir(parents=True, exist_ok=True)
    metadata = folder / 'source.json'
    if metadata.exists():
        saved = json.loads(metadata.read_text(encoding='utf-8'))
        if Path(saved['file']).is_file() and Path(saved['file']).resolve().parent == folder.resolve():
            return saved
    class Logger:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass
    last = [0]
    def hook(state):
        downloaded = state.get('downloaded_bytes', 0)
        if downloaded > 1_000_000_000:
            raise ValueError('Video exceeds the 1 GB source limit')
        if downloaded - last[0] > 10_000_000:
            last[0] = downloaded
            progress('Downloading public video: %d MB' % (downloaded / 1e6))
    options = {'format': 'bestvideo[ext=mp4][vcodec^=avc1][height<=720]+bestaudio[ext=m4a]/best[height<=720]/bestvideo[height<=720]+bestaudio',
               'outtmpl': str(folder / 'video.%(ext)s'), 'noplaylist': True,
               'max_filesize': 1_000_000_000, 'socket_timeout': 15, 'retries': 0,
               'extractor_retries': 0, 'fragment_retries': 0, 'proxy': '',
               'quiet': True, 'no_warnings': True, 'logger': Logger(),
               'progress_hooks': [hook], 'overwrites': False, 'merge_output_format': 'mp4',
               'ffmpeg_location': data['ffmpeg'], 'fixup': 'never',
               'js_runtimes': {'node': {'path': data['node']}},
               'match_filter': lambda info, **_: 'Live and age-restricted videos are unsupported' if info.get('is_live') or info.get('age_limit', 0) >= 18 else None}
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info('https://www.youtube.com/watch?v=' + ident, download=True)
        file = Path(downloader.prepare_filename(info)).resolve()
    if file.parent != folder.resolve() or not file.is_file():
        raise ValueError('No complete public video file was downloaded')
    result = {'file': str(file), 'title': str(info.get('title') or ident)[:300],
              'author': str(info.get('uploader') or 'YouTube creator')[:200], 'duration': info.get('duration')}
    metadata.write_text(json.dumps(result), encoding='utf-8')
    return result

def probe(data):
    import av
    with av.open(data['file'],options={'protocol_whitelist':'file,pipe'}) as container:
        duration = container.duration / av.time_base if container.duration else None
        if not duration:
            duration = max((float(s.duration * s.time_base) for s in container.streams if s.duration and s.time_base), default=0)
        return {'duration': duration, 'hasVideo': bool(container.streams.video), 'hasAudio': bool(container.streams.audio)}

def transcribe(data):
    from faster_whisper import WhisperModel
    import numpy as np
    import wave
    start, end = float(data.get('start', 0)), float(data['end'])
    if not (0 <= start < end <= 86400):
        raise ValueError('Invalid transcription window')
    model_name = data.get('model', 'small.en')
    if model_name not in ['tiny.en', 'base.en', 'small.en', 'medium.en']:
        raise ValueError('Choose a supported local transcription model')
    model_path = ROOT / '.tools/models' / model_name
    if not (model_path / 'model.bin').is_file():
        raise FileNotFoundError('Run npm run setup:sources to install the local transcription model')
    progress('Loading local speech model: ' + model_name)
    model = WhisperModel(str(model_path), device='cpu', compute_type='int8', local_files_only=True,
                         cpu_threads=max(1, min(8, os.cpu_count() or 4)))
    with tempfile.TemporaryDirectory(prefix='speech-', dir=ROOT / '.local-data') as temporary:
        audio = Path(temporary) / 'window.wav'
        subprocess.run([data['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(start),
                        '-protocol_whitelist', 'file,pipe', '-i', data['file'], '-t', str(end-start),
                        '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(audio)], check=True, capture_output=True,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        with wave.open(str(audio), 'rb') as pcm:
            samples = np.frombuffer(pcm.readframes(pcm.getnframes()), dtype='<i2').astype(np.float32) / 32768.0
        chunks, info = model.transcribe(samples, language='en', beam_size=5,
                                        initial_prompt='Programming tutorial. JavaScript, ECMAScript, ECMA, Node.js, var, let, const, this. Python, PyTorch, tensors, variables, functions.',
                                        vad_filter=True, condition_on_previous_text=False)
        rows = []
        for chunk in chunks:
            if chunk.text.strip() and chunk.end > chunk.start:
                rows.append({'start': start+chunk.start, 'end': min(end, start+chunk.end), 'text': chunk.text.strip()})
                progress('Transcribed through %.0f seconds locally' % (start+chunk.end))
    if not rows:
        raise ValueError('No speech was recognized in the selected window')
    return {'segments': rows, 'origin': 'Local Faster Whisper ' + model_name + ' speech recognition, CPU int8. Machine transcript: code terms, numbers, timing and completeness need review; silence detection can omit quiet speech.'}

def setup_model(data):
    from faster_whisper.utils import download_model
    model = data.get('model', 'small.en')
    if model not in ['tiny.en', 'base.en', 'small.en', 'medium.en']:
        raise ValueError('Unsupported speech model')
    destination = ROOT / '.tools/models' / model
    destination.mkdir(parents=True, exist_ok=True)
    download_model(model, output_dir=str(destination))
    return {'model': model, 'installed': (destination / 'model.bin').is_file()}

def read_frames(data):
    from rapidocr_onnxruntime import RapidOCR
    from statistics import median
    engine = RapidOCR(intra_op_num_threads=2, inter_op_num_threads=2)
    output = []
    for index, name in enumerate(data['files']):
        file = Path(name).resolve()
        if not file.is_relative_to((ROOT / '.local-data/frames').resolve()):
            raise ValueError('OCR reads captured frames only')
        result, _ = engine(str(file))
        entries = []
        for box, text, score in result or []:
            if text.strip():
                entries.append({'x':min(p[0] for p in box),'y':min(p[1] for p in box),'height':max(p[1] for p in box)-min(p[1] for p in box),
                                'width':max(p[0] for p in box)-min(p[0] for p in box),'text':text,'score':float(score)})
        entries.sort(key=lambda row:(row['y'],row['x']))
        lines = []
        for entry in entries:
            if lines and abs(lines[-1][0]['y']-entry['y']) < max(4, entry['height']*.45):
                lines[-1].append(entry)
            else:
                lines.append([entry])
        origin = min((e['x'] for e in entries), default=0)
        char_width = max(4, median([e['width']/len(e['text']) for e in entries]) if entries else 8)
        text_lines = []
        for line in lines:
            line.sort(key=lambda e:e['x'])
            indent = min(40, max(0, round((line[0]['x']-origin)/char_width)))
            text_lines.append(' '*indent+'  '.join(e['text'] for e in line))
        output.append({'index':index,'text':'\n'.join(text_lines),'confidence':sum(e['score'] for e in entries)/len(entries) if entries else 0})
        progress('Read printed screen text %d of %d locally' % (index+1,len(data['files'])))
    return {'frames':output}

if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        actions = {'captions': captions, 'video': download_video, 'probe': probe, 'transcribe': transcribe, 'setup-model': setup_model,'ocr':read_frames}
        result = actions[request['action']](request)
        print(json.dumps({'result': result}, ensure_ascii=True), flush=True)
    except Exception as error:
        kind = type(error).__name__
        messages = {'RequestBlocked': 'YouTube blocked the public caption request from this connection.',
                    'IpBlocked': 'YouTube blocked the public caption request from this connection.',
                    'TranscriptsDisabled': 'This video does not expose a public caption track.',
                    'NoTranscriptFound': 'No supported English caption track was found.',
                    'DownloadError': 'YouTube did not provide a usable public video download. No cookies, proxies or authentication workarounds were attempted.',
                    'ModuleNotFoundError': 'Install local source tools with npm run setup:sources.',
                    'FileNotFoundError': 'A local source tool or speech model is missing. Run npm run setup:sources.'}
        print(json.dumps({'error': {'code': kind, 'message': messages.get(kind, 'The local source operation failed (' + kind + '). Check the source or local tool installation.')}}), flush=True)
        sys.exit(1)
