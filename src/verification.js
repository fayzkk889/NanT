export function verify(chapter, evidence, framePlan, generated) {
  const expected = chapter.segments.map(s => s.id);
  const assigned = generated.draft.sections.flatMap(s => s.segment_ids);
  const covered = new Set(assigned.filter(id => expected.includes(id)));
  const ordered = assigned.length === expected.length && expected.every((id, i) => assigned[i] === id);
  const gaps = [];
  let cursor = chapter.start;
  for (const s of chapter.segments) {
    if (s.start - cursor > 10) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (chapter.end - cursor > 10) gaps.push({ start: cursor, end: chapter.end });
  const warnings = [];
  if (chapter.segments.some(s => s.endEstimated)) warnings.push('Some cue boundaries are estimated, including sentence splits, pasted timestamps or clipped speech. Source alignment needs review.');
  if (gaps.length) warnings.push(`${gaps.length} interval(s) lack captions for over 10 seconds; silence and missing material cannot be distinguished.`);
  if (chapter.actualStart < chapter.start || chapter.actualEnd > chapter.end) warnings.push('A caption crosses the requested window boundary and is preserved in full. Adjacent custom windows may repeat that cue.');
  const overlaps = chapter.segments.filter((s, i, rows) => i && s.start < rows[i - 1].end).length;
  if (overlaps) warnings.push('Some caption cues overlap. Rolling caption text is preserved without deduplication to avoid deleting teaching content.');
  const missingFrames = framePlan.filter(f => f.status === 'capture-needed').length;
  if (missingFrames) warnings.push(`${missingFrames} suggested screen checks have no nearby supplied visual record. Important unspoken details may be missing.`);
  const proseLength = generated.draft.sections.reduce((n, s) => n + s.markdown.length, 0);
  const sourceLength = chapter.segments.reduce((n, s) => n + s.text.length, 0);
  const ratio = sourceLength ? proseLength / sourceLength : 0;
  if (generated.mode === 'model' && ratio < 0.65) warnings.push('The prose is much shorter than the transcript. Check for summary-like compression despite complete segment ID coverage.');
  for (const section of generated.draft.sections) for (const uncertainty of section.uncertainties) warnings.push(`${section.heading}: ${uncertainty}`);
  return {
    status: 'needs_review', semanticFidelity: 'not_verified',
    segmentCoverage: { covered: covered.size, total: expected.length }, chronologicalOrder: ordered,
    visualRecords: evidence.length, codeStates: evidence.filter(e => e.kind === 'code').length,
    terminalRecords: evidence.filter(e => e.kind === 'terminal').length,
    missingFrameChecks: missingFrames, captionGaps: gaps, proseToSourceRatio: Math.round(ratio * 100) / 100,
    warnings,
    limits: 'Coverage counts source IDs, not teaching points. Supplied visuals and code are retained verbatim; their transcription and semantic accuracy are not independently verified. The whole video has not been converted.'
  };
}
