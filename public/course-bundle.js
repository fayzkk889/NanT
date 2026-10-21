export const MAX_BOOK_CHAPTERS=96;
export const MAX_BUNDLE_BYTES=200_000_000;

// A book's combined timeline is reconstructed on import. Exporting it again
// would duplicate every image already stored in the individual chapters.
export function bundleForExport(result){
  return result.schemaVersion===2 && result.conversionScope==='full-video'
    ? {schemaVersion:2,conversionScope:'full-video',chapters:result.chapters}
    : result;
}
