import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { runPipeline } from '../src/pipeline.js';

const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('fixtures/original-lesson.json', root), 'utf8'));
const result = await runPipeline({ demo: true, start: 0, duration: 480 }, { fixture });
await mkdir(new URL('examples/', root), { recursive: true });
await writeFile(new URL('examples/original-lesson.md', root), result.markdown);
await writeFile(new URL('examples/original-lesson.evidence.json', root), JSON.stringify(result, null, 2));
console.log('Exported the original eight-minute lesson and evidence report to examples/.');
