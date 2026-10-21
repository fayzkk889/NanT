import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb, PDFString } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { InputError } from './errors.js';
import { timeLabel } from './transcript.js';
import { timestampURL } from './youtube.js';
import { isContextFrame,partitionFrames } from './evidence.js';
import {usableExamples,exampleText} from './screen-examples.js';
import {hasReadingMaterials,readingFrames} from './reading-materials.js';

export const PDF_STYLES = {
  textbook: { name: 'Textbook', eyebrow: 'THE WRITTEN COURSE', accent: '#ad3e27', ink: '#25272b', paper: '#fcfaf5', code: '#f0eee6', body: 11, leading: 16.8, margin: 58, serif: true },
  companion: { name: 'Code Companion', eyebrow: 'READ / BUILD / UNDERSTAND', accent: '#156b63', ink: '#183c39', paper: '#f7fcfa', code: '#e8f2ee', body: 10.3, leading: 15.7, margin: 50, serif: false },
  classic: { name: 'Print Classic', eyebrow: 'PROGRAMMING TUTORIAL / WRITTEN EDITION', accent: '#242424', ink: '#1e1e1e', paper: '#ffffff', code: '#f3f3f3', body: 10.6, leading: 15.9, margin: 62, serif: true }
};
const color = hex => rgb(...hex.replace('#', '').match(/../g).map(n => parseInt(n, 16) / 255));
const fontRoot = new URL('../assets/fonts/', import.meta.url);
let assets;
async function fontAssets() {
  if (!assets) assets = Promise.all(['DejaVuSans.ttf', 'SourceCodePro-Regular.ttf'].map(name => readFile(new URL(name, fontRoot))));
  return assets;
}
function clean(text) { return String(text).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    '); }
function proseText(text) { return clean(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, ''); }

export async function createChapterPDF(result, styleName = 'textbook', {edition='lesson',timestamps=false}={}) {
  if(!['lesson','notes','source'].includes(edition))throw new InputError('Choose Full lesson, Study notes, or Source review.');
  if(!Object.hasOwn(PDF_STYLES,styleName))throw new InputError('Choose Textbook, Code Companion, or Print Classic.');
  const sourceEdition=edition==='source';
  if(!sourceEdition && readingFrames(result).length && !hasReadingMaterials(result))throw new InputError('Prepare readable code before exporting a clean lesson, or choose Source review to retain the screens.');
  const baseStyle = PDF_STYLES[styleName];
  const style=baseStyle && {...baseStyle,...(edition==='notes'?{body:baseStyle.body-.5,leading:baseStyle.leading-2.5,margin:48}:{})};
  const examples=usableExamples(result.generated.screenExamples,result.chapter.segments);
  if (!style) throw new InputError('Choose Textbook, Code Companion, or Print Classic.');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const [sansBytes, monoBytes] = await fontAssets();
  const sans = await pdf.embedFont(sansBytes, { subset: true });
  const mono = await pdf.embedFont(monoBytes, { subset: true });
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const body = style.serif ? serif : sans;
  const width = 595.28, height = 841.89, margin = style.margin, usable = width - margin * 2;
  const ink = color(style.ink), accent = color(style.accent), muted = color('#747b79');
  let page, y, number = 0;
  const fontFor = (text, preferred) => { try { preferred.encodeText(text); return preferred; } catch { return sans; } };
  function draw(text, x, baseline, font = body, size = style.body, tint = ink) {
    const safe = clean(text).replace(/\n/g, ' '); const actualFont = fontFor(safe, font);
    page.drawText(safe, { x, y: baseline, font: actualFont, size, color: tint });
  }
  function newPage() {
    page = pdf.addPage([width, height]); number++;
    page.drawRectangle({ x: 0, y: 0, width, height, color: color(style.paper) });
    page.drawLine({ start: { x: margin, y: height - 39 }, end: { x: width - margin, y: height - 39 }, thickness: .5, color: color('#d8dcda') });
    draw('NanT', margin, height - 29, sans, 7.2, accent);
    draw(`${style.name.toUpperCase()} / ${sourceEdition?'SOURCE REVIEW':edition==='notes'?'STUDY NOTES':'WRITTEN LESSON'}`, margin + 125, height - 29, mono, 6.8, muted);
    draw(`${String(number).padStart(2, '0')}`, width - margin - 13, 30, mono, 8, accent);
    draw(sourceEdition?'Source-linked written edition':result.source.author, margin, 30, sans, 7, muted);
    y = height - 70;
  }
  function space(required) { if (y - required < 59) newPage(); }
  function wrap(text, font, size, maxWidth = usable) {
    const actualFont = fontFor(text, font);
    const lines = [];
    for (const raw of text.split('\n')) {
      if (!raw) { lines.push(''); continue; }
      let current = '';
      for (const word of raw.split(/\s+/)) {
        const candidate = current ? `${current} ${word}` : word;
        if (actualFont.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
        else {
          if (current) lines.push(current); current = '';
          let part = '';
          for (const char of word) {
            if (part && actualFont.widthOfTextAtSize(part + char, size) > maxWidth) { lines.push(part); part = char; } else part += char;
          }
          current = part;
        }
      }
      lines.push(current);
    }
    return lines;
  }
  function paragraph(text, { font = body, size = style.body, leading = style.leading, tint = ink, after = edition==='notes'?7:11, maxWidth = usable } = {}) {
    const lines = wrap(proseText(text), font, size, maxWidth);
    // Keep ordinary paragraphs together so a single trailing line is never
    // stranded at the top of the following page.
    if (lines.length * leading + after < height - 145) space(lines.length * leading + after);
    for (let i = 0; i < lines.length; i++) { space(leading * (i === 0 && lines.length > 1 ? 2 : 1)); draw(lines[i], margin, y, font, size, tint); y -= leading; }
    y -= after;
  }
  function heading(text, level = 2) {
    const size = level === 1 ? (edition==='notes'?24:30) : level === 2 ? (edition==='notes'?15:19) : 11;
    const font = level === 3 ? sans : style.serif ? serif : sans;
    const lines = wrap(proseText(text), font, size);
    space(lines.length * (size + 5) + 70);
    y -= level === 2 ? 14 : 5;
    for (const line of lines) { draw(line, margin, y, font, size, level === 3 ? accent : ink); y -= size + 5; }
    y -= 7;
  }
  function timestamp(at, label = '') {
    if(!sourceEdition && !timestamps)return;
    const text = `${timeLabel(at)}${label ? `  /  ${label}` : ''}`;
    space(25); draw(text, margin, y, mono, 7.6, accent);
    const url = timestampURL(result.source, at);
    if (url) {
      const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [margin, y - 2, margin + 65, y + 10], Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } });
      const ref = pdf.context.register(annotation);
      page.node.addAnnot(ref);
    }
    y -= 21;
  }
  function codeBlock(text, kind) {
    // Preserve every character. Scale long code lines to fit instead of breaking
    // syntax or clipping them. Large blocks split only between complete lines.
    let lines = clean(text).split('\n');
    const longest = Math.max(...lines.map(line => mono.widthOfTextAtSize(line, 1)), 1);
    const size = Math.min(edition==='notes'?8.2:styleName === 'companion' ? 9.3 : 8.7, (usable - 28) / longest);
    const actualSize = Math.max(7.5, size);
    if (size < 7.5) {
      paragraph('Long source lines wrap visually below. Use the evidence JSON for exact original line breaks.', { font: sans, size: 8, leading: 12 });
      lines = lines.flatMap(line => {
        const parts = []; let current = '';
        for (const char of line) {
          if (current && mono.widthOfTextAtSize(current + char, actualSize) > usable - 28) { parts.push(current); current = char; } else current += char;
        }
        parts.push(current); return parts;
      });
    }
    const leading = actualSize * (edition==='notes'?1.3:1.55);
    if (lines.length * leading + 35 < height - 150) space(lines.length * leading + 35);
    let offset = 0;
    while (offset < lines.length) {
      space(Math.min(lines.length - offset, 4) * leading + 39);
      const count = Math.min(lines.length - offset, Math.max(1, Math.floor((y - 76 - 24) / leading)));
      const blockHeight = count * leading + 25;
      page.drawRectangle({ x: margin, y: y - blockHeight + 8, width: usable, height: blockHeight, color: color(style.code) });
      page.drawRectangle({ x: margin, y: y - blockHeight + 8, width: 2, height: blockHeight, color: accent });
      for (let i = 0; i < count; i++) draw(lines[offset + i], margin + 14, y - 10 - i * leading, mono, actualSize, ink);
      y -= blockHeight + 10; offset += count;
      if (offset < lines.length) { newPage(); timestampLabel(`${kind.toUpperCase()} / CONTINUED`); }
    }
  }
  function timestampLabel(text) { space(25); draw(text, margin, y, mono, 7.5, accent); y -= 22; }
  async function imageRecord(event,prepared=null,maxHeight=340) {
    if (!event.image) return;
    const [prefix, base64] = event.image.split(',');
    if (prefix.includes('webp')) { paragraph('WebP frame retained in the evidence JSON. Use a PNG or JPEG record to embed this frame in PDF.', { font: sans, size: 8.5 }); return; }
    try {
      const bytes = Buffer.from(base64, 'base64');
      const embedded = prepared || (prefix.includes('png') ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes));
      const factor = Math.min(usable / embedded.width, maxHeight / embedded.height, 1);
      const w = embedded.width * factor, h = embedded.height * factor;
      space(h + 25); page.drawImage(embedded, { x: margin, y: y - h, width: w, height: h }); y -= h + 17;
    } catch { throw new InputError('A supplied frame is not a valid PNG or JPEG. Replace the image before exporting PDF.'); }
  }
  newPage(); timestampLabel(sourceEdition?style.eyebrow:edition==='notes'?'STUDY NOTES':'THE WRITTEN LESSON'); y -= edition==='notes'?0:12;
  heading(result.source.title, 1);
  paragraph(result.source.author, { font: sans, size: 10, leading: 15, tint: muted });
  if(!sourceEdition)paragraph('A chapter from the original lesson',{font:sans,size:8.5,leading:12,tint:muted,after:8});
  if(!sourceEdition){
    paragraph(`${result.generated.mode==='model'?'AI-written from the original lesson.':'Original transcript; no lesson rewriting.'} Screen-transcribed code can contain errors; review important examples. Full source records remain available separately.`,{font:sans,size:8,leading:12,tint:muted,after:6});
    if(result.source.url){const label='Original lesson';draw(label,margin,y,sans,8,accent);page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[margin,y-2,margin+80,y+10],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(timestampURL(result.source,result.chapter.start) || result.source.url)}})));y-=18;}
  }
  if (result.source.license) paragraph(`${result.source.license.attribution} ${result.source.license.name}: ${result.source.license.url}. ${result.source.license.notice}`, {font:sans,size:8,leading:12,tint:muted});
  if(!sourceEdition && result.generated.mode!=='model')paragraph('Source transcript edition. This chapter has not been rewritten into a lesson.',{font:sans,size:9,leading:13,tint:muted});
  if(sourceEdition || timestamps)timestampLabel(`${timeLabel(result.chapter.start)} - ${timeLabel(result.chapter.end)} / ${result.generated.sourceFallbackSegments?.length ? 'DRAFT WITH ORIGINAL PASSAGES' : result.generated.mode === 'model' ? 'AI-WRITTEN CHAPTER' : 'SOURCE TRANSCRIPT EDITION'}`);
  if(sourceEdition || result.source.synthetic)paragraph(result.source.synthetic ? 'Original demonstration lesson. This is not a Karpathy transcript or a recording; timestamps simulate a lesson timeline.' : result.provenance,
    { font: sans, size: 8.5, leading: 13, tint: muted, after: 14 });
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 1.5, color: accent }); y -= 24;
  if(!sourceEdition){
    const stream=result.generated.draft.sections.map((section,index)=>({type:'section',at:result.chapter.segments.find(s=>s.id===section.segment_ids[0]).start,section,index}));
    const explicit=result.evidence.filter(e=>['code','terminal','diagram','note'].includes(e.kind));
    stream.push(...explicit.map(event=>({type:'record',at:event.at,event})),...(result.generated.readingMaterials?.items || []).map(item=>({type:'material',at:item.at,item})),...examples.map(example=>({type:'example',at:example.at,example})));
    const rank={section:0,example:1,record:2,material:3};stream.sort((a,b)=>a.at-b.at || rank[a.type]-rank[b.type] || (a.index || 0)-(b.index || 0));
    for(const entry of stream){
      if(entry.type==='section'){
        heading(entry.section.heading);timestamp(entry.at);
        for(const part of entry.section.markdown.split(/\n\s*\n/))paragraph(part);
        for(const note of entry.section.uncertainties || [])paragraph('Review note: '+note,{font:sans,size:8.5,leading:12,tint:muted,after:8});
      }else if(entry.type==='material'){
        const item=entry.item;timestamp(item.at);
        if(item.code.trim())codeBlock(item.code,'code');
        if(item.output.trim()){heading('Output',3);codeBlock(item.output,'output');}
        if(item.description.trim())paragraph(item.description);
      }else if(entry.type==='example'){
        heading('Worked example',3);timestamp(entry.at);codeBlock(`Encoded IDs: ${JSON.stringify(entry.example.encoded)}\nDecoded text: ${JSON.stringify(entry.example.decoded)}${entry.example.vocabSize?`\nVocabulary size: ${entry.example.vocabSize}`:''}`,'example');
      }else{
        heading(entry.event.title,3);timestamp(entry.at);
        if(['code','terminal'].includes(entry.event.kind))codeBlock(entry.event.content,entry.event.kind);else paragraph(entry.event.content);
      }
    }
    pdf.setTitle(result.source.title);pdf.setAuthor(result.source.author);pdf.setSubject(`${style.name} - ${edition==='notes'?'Study notes':'Full written lesson'}`);pdf.setCreator('NanT');pdf.setKeywords(['programming tutorial',edition,style.name]);
    return Buffer.from(await pdf.save());
  }
  // Detailed source review retains every original screen and source record.
  const stream = result.generated.draft.sections.map((section, i) => ({ type: 'section', at: result.chapter.segments.find(s => s.id === section.segment_ids[0]).start, section, index: i }));
  const selectedFrames=partitionFrames(result.chapter,result.evidence),contextFrames=selectedFrames.additional;
  stream.push(...examples.map(example=>({type:'example',at:example.at,example})));
  stream.push(...selectedFrames.primary.map(event => ({ type: 'evidence', at: event.at, event })));
  const rank={section:0,example:1,evidence:2};stream.sort((a,b)=>a.at-b.at || rank[a.type]-rank[b.type] || (a.index || 0)-(b.index || 0));
  for (const item of stream) {
    if (item.type === 'section') {
      const firstParagraph = item.section.markdown.split(/\n\s*\n/)[0];
      const openingLines = wrap(proseText(firstParagraph), body, style.body).length;
      space(Math.min(height - 150, 100 + openingLines * style.leading));
      heading(item.section.heading); timestamp(item.at, item.section.segment_ids.join(', '));
      for (const part of item.section.markdown.split(/\n\s*\n/)) paragraph(item.section.heading.startsWith('Original explanation:') ? part.replace(/\s*\n\s*/g,' ') : part);
    } else if(item.type==='example'){
      space(180);heading('Displayed example',3);timestamp(item.at,'repeated screen reading');codeBlock(exampleText(item.example),'screen observation');paragraph('Machine-read values. Compare the original screen.',{font:sans,size:8.5,leading:12});
    } else {
      const automaticFrame=item.event.kind==='frame' && item.event.image && /Extracted automatically/.test(item.event.origin || '');
      const codeLike = !automaticFrame && ['code', 'terminal', 'diagram', 'frame'].includes(item.event.kind);
      let preparedImage=null;
      if(automaticFrame && !item.event.image.startsWith('data:image/webp')){
        try{const [prefix,data]=item.event.image.split(',');preparedImage=prefix.includes('png')?await pdf.embedPng(Buffer.from(data,'base64')):await pdf.embedJpg(Buffer.from(data,'base64'));}
        catch{throw new InputError('A captured frame is not a valid PNG or JPEG.');}
        const frameHeight=preparedImage.height*Math.min(usable/preparedImage.width,260/preparedImage.height,1);
        space(frameHeight+95);
      }
      // Keep the event title, timestamp and at least its opening code lines
      // together. Short code records move as a unit.
      if (codeLike) space(120 + Math.min(clean(item.event.content).split('\n').length, 32) * 15);
      heading(item.event.title, 3); timestamp(item.at, `${item.event.kind} / ${item.event.id}`);
      if (codeLike) codeBlock(item.event.content, item.event.kind);
      else if(automaticFrame)paragraph('Original screen. Approximate machine readings remain in the source bundle.',{font:sans,size:8.5,leading:12,after:6});
      else paragraph(item.event.content, { font: sans, size: 9.4, leading: 15 });
      await imageRecord(item.event,preparedImage,automaticFrame?260:340);
    }
  }
  if (contextFrames.length) {
    newPage(); heading('Additional captured frames',1);
    paragraph('Every additional capture is retained here at its original embedded resolution. The lesson selects a screen near the end of each teaching passage and both ends of explicit mistake/correction demonstrations. Earlier states, actions and brief details can matter: zoom these images when needed. Complete observations remain in the source bundle.',{font:sans,size:9,leading:14});
    const columns=3, gap=12, cellWidth=(usable-gap*(columns-1))/columns, rowHeight=124;
    for (let i=0;i<contextFrames.length;i+=columns) {
      space(rowHeight); const top=y;
      for (let column=0;column<columns && i+column<contextFrames.length;column++) {
        const event=contextFrames[i+column], x=margin+column*(cellWidth+gap);
        const [prefix,base64]=event.image.split(',');
        if (prefix.includes('webp')) continue;
        const embedded=prefix.includes('png') ? await pdf.embedPng(Buffer.from(base64,'base64')) : await pdf.embedJpg(Buffer.from(base64,'base64'));
        const scale=Math.min(cellWidth/embedded.width,96/embedded.height);
        page.drawImage(embedded,{x,y:top-embedded.height*scale,width:embedded.width*scale,height:embedded.height*scale});
        draw(`${timeLabel(event.at)} / ${event.id}`,x,top-108,mono,7,accent);
        const url=timestampURL(result.source,event.at);
        if(url) page.node.addAnnot(pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[x,top-112,x+cellWidth,top],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}})));
      }
      y=top-rowHeight;
    }
  }
  newPage(); heading('Source notes & review', 1);
  paragraph('This chapter retains the supplied source sequence and visual records. Source-ID coverage is a structural check; it does not prove that every teaching point is correct or fully preserved.');
  for (const warning of [...result.generated.warnings, ...result.report.warnings]) paragraph(warning, { font: sans, size: 9, leading: 14 });
  if (result.source.url) paragraph(`Original video: ${result.source.url}`, { font: mono, size: 8, leading: 13 });
  if(result.source.relatedCode)paragraph(`${result.source.relatedCode.title}: ${result.source.relatedCode.url}. ${result.source.relatedCode.license}. The repository may contain a later code state; use captured screens for the chapter timeline.`,{font:sans,size:9,leading:14});
  paragraph(`Source IDs: ${result.report.segmentCoverage.covered}/${result.report.segmentCoverage.total}. Code states: ${result.report.codeStates}. Terminal records: ${result.report.terminalRecords}. Semantic fidelity: not independently verified.`, { font: sans, size: 9, leading: 14 });
  if (result.generated.mode === 'model') {
    heading('Complete source wording', 2);
    for (const s of result.chapter.segments) {
      space(Math.min(height - 150, wrap(proseText(s.text), sans, 9).length * 14 + 40));
      timestamp(s.start, s.id); paragraph(s.text, { font: sans, size: 9, leading: 14 });
    }
  }
  pdf.setTitle(result.source.title); pdf.setAuthor(result.source.author); pdf.setSubject(`${style.name} - ${result.generated.mode === 'model' ? 'AI-written tutorial' : 'Source transcript edition'}`);
  pdf.setCreator('NanT'); pdf.setKeywords(['programming tutorial', style.name, 'timestamped written course']);
  return Buffer.from(await pdf.save());
}
