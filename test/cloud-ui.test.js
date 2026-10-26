import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInputError,savedChapterLabel,resumeButtonLabel} from '../public/cloud-course.js';
import {SOURCE_REVISION,sourceCells,currentSourceCheckpoint} from '../public/source-policy.js';
const input={sourceType:'youtube',url:'https://youtu.be/rfscVS0vtbw',start:1129,duration:300};
test('A visitor gets source validation before any conversion starts',()=>{
  assert.equal(sourceInputError(input),null);
  for(const url of ['https://example.com/tutorial','https://youtube.com/playlist?list=abc','https://youtube.com/watch?v=bad','https://youtu.be/rfscVS0vtbw.evil','https://user:secret@youtube.com/watch?v=rfscVS0vtbw'])assert.match(sourceInputError({...input,url}),/YouTube video link/);
  for(const url of ['youtube.com/watch?v=rfscVS0vtbw','https://www.youtube.com/watch?v=rfscVS0vtbw&t=1129s','https://m.youtube.com/watch?v=rfscVS0vtbw'])assert.equal(sourceInputError({...input,url}),null);
  assert.match(sourceInputError({...input,start:NaN}),/chapter start/);
});
test('Saved chapters identify their time windows and retries do not claim nonexistent saved source',()=>{
  const row={title:'Python course',result:{chapter:{start:1129,end:1429}}};assert.equal(savedChapterLabel(row),'Python course · 18:49–23:49');
  assert.doesNotMatch(resumeButtonLabel({parts:[]}),/saved steps/);assert.match(resumeButtonLabel({parts:[{}]}),/Resume saved steps/);
});
test('Reader upgrades invalidate old video progress without invalidating supplied transcripts',()=>{
  assert.equal(currentSourceCheckpoint({input:{sourceType:'youtube'},parts:[{}]}),false);
  assert.equal(currentSourceCheckpoint({sourceRevision:SOURCE_REVISION,input:{sourceType:'youtube'}}),true);
  assert.equal(currentSourceCheckpoint({input:{sourceType:'local'}}),true);
  assert.deepEqual(sourceCells(1198,1223),[{index:0,start:1198,end:1208},{index:1,start:1208,end:1218},{index:2,start:1218,end:1223}]);
});
