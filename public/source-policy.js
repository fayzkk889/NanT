// Shared by browser planning, server validation and cache/checkpoint versioning.
// A source cell is an acquisition interval, not a measured sentence boundary.
export const SOURCE_REVISION = 'speech-cells-v3';
export const SOURCE_PART_SECONDS = 30;
export function sourceCells(start, end) {
  return Array.from({length: Math.ceil((end-start)/10)}, (_, index) => ({
    index, start: start+index*10, end: Math.min(end, start+(index+1)*10)
  }));
}
export function currentSourceCheckpoint(checkpoint) {
  return checkpoint?.input?.sourceType !== 'youtube' || checkpoint.sourceRevision === SOURCE_REVISION;
}
