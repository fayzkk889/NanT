import { readFile, writeFile } from 'node:fs/promises';
import { runPipeline } from '../src/pipeline.js';
import { createChapterPDF, PDF_STYLES } from '../src/pdf.js';
const root = new URL('../', import.meta.url);
const fixture = JSON.parse(await readFile(new URL('fixtures/original-lesson.json', root), 'utf8'));
const useLocal = process.argv.includes('--local');
const result = useLocal
  ? await runPipeline({ demo: true, useModel: true, provider: 'local' }, { fixture, onStage: stage => console.log(stage) })
  : JSON.parse(await readFile(new URL('examples/local-lesson.evidence.json', root), 'utf8'));
if (useLocal && result.generated.mode !== 'model') throw new Error(result.generated.warnings.join(' '));
await writeFile(new URL('examples/local-lesson.evidence.json', root), JSON.stringify(result, null, 2));
await writeFile(new URL('examples/local-lesson.md', root), result.markdown);
for (const style of Object.keys(PDF_STYLES)) {
  const bytes = await createChapterPDF(result, style);
  await writeFile(new URL(`../tokenizer-${style}.pdf`, root), bytes);
  console.log(`${style}: ${bytes.length} bytes`);
}
console.log(`Generation: ${result.generated.mode}; ${result.generated.model || 'no model'}`);
