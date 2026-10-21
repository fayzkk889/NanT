# Software and source notices

The MIT license in LICENSE covers the original NanT software and documentation. It does not relicense tutorial recordings, captions, creator code, imported files, model weights, fonts or dependency code.

Bundled font notices are in `assets/fonts/DejaVu-LICENSE.txt` and `assets/fonts/SourceCodePro-LICENSE.md`. Keep those with redistributed font files. Source Code Pro uses the SIL Open Font License; DejaVu retains its included font-specific license notices.

JavaScript dependencies are installed with npm from package-lock.json. Retain their installed license notices when redistributing them: pdf-lib, @pdf-lib/fontkit, @pdf-lib/standard-fonts, @pdf-lib/upng, pako and tslib.

Optional local source dependencies are installed separately from requirements-source.txt: youtube-transcript-api (MIT), yt-dlp (Unlicense), faster-whisper (MIT), and RapidOCR (Apache-2.0), with their own transitive dependencies. FFmpeg licensing depends on the installed binary/build; its upstream notices remain applicable. These installed runtimes and binaries are excluded from the source archive.

Local Whisper and Ollama weights retain their model publishers' licenses. Model setup downloads weights only; tutorial processing does not call a hosted model. Downloaded models are excluded from the source archive.

Source attribution is kept in chapter exports. MIT OpenCourseWare-derived material retains its CC BY-NC-SA notices. User-selected YouTube videos and imported media retain their source rights; making the app free or open source does not change those rights. Exporting notes is a local operation; the app has no public course-publishing service.
