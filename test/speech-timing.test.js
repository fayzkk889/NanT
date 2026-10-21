import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSpeechTiming} from '../src/speech-timing.js';
import {parseTranscript} from '../src/transcript.js';
test('Post-window Whisper hypotheses cannot create reversed cues or contaminate the timed lesson',()=>{
 const raw={segments:[{start:310,end:315,text:'The final spoken phrase.'},{start:319.91,end:315,text:'.'},{start:324.91,end:315,text:'.'}]};
 const result=normalizeSpeechTiming(raw,{start:0,end:315});
 assert.equal(result.segments.length,1);assert.equal(result.unalignedSegments.length,2);assert.equal(raw.segments.length,3);assert.ok(result.timingNotes.length);assert.doesNotThrow(()=>parseTranscript(result.segments));
 assert.throws(()=>normalizeSpeechTiming({segments:raw.segments.slice(1)},{start:0,end:315}),/no speech aligned/);
});
test('A zero-width cue inside the recording preserves its words on an explicitly approximate neighboring cue',()=>{
 const result=normalizeSpeechTiming({segments:[{start:0,end:4,text:'Initialize total.'},{start:4,end:4,text:'Use zero.'},{start:5,end:7,text:'Compare the next pair.'}]},{start:0,end:10});
 assert.equal(result.segments[0].text,'Initialize total. Use zero.');assert.equal(result.segments[0].endEstimated,true);assert.equal(result.segments[0].end,4);assert.equal(result.segments.length,2);
});
