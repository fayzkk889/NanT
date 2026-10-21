# A source-preserving written edition

Source: Build a reversible character tokenizer · Course Zero · original test lesson

Window: 00:00 (fixture time; no source video)–08:00 · Source-preserving edition · Needs review

Provenance: Original eight-minute teaching fixture authored for this MVP. All timestamps simulate a lesson timeline. No Karpathy transcript, video frames, or narration are included.

> Source edition: complete supplied wording is retained. No model has rewritten this into polished teaching prose.

> 8 suggested screen checks have no nearby supplied visual record. Important unspoken details may be missing.

> ORIGINAL TEST FIXTURE. This is an authored eight-minute lesson, not a transcript of Karpathy or a recording. Times simulate a video timeline.

## Start with something we can reverse

00:00 (fixture time; no source video) · Source s00001

A language model works with numbers, but our training material starts as text. Before building a model, we need a reversible way to move between those two representations. We will use a deliberately small corpus: the six-character string ababa!. Our goal is to turn each character into an integer and then recover exactly the original string. We are not predicting anything yet. This is only a representation step.

Keep three different quantities separate. The text has six positions. It uses three distinct characters: a, b, and the exclamation mark. Each position will become one token, while the vocabulary will contain one entry per distinct character. A repeated a must receive the same ID every time. These IDs are labels, not numerical measurements: assigning a larger number to b would not make b more important than a.

## The first version: discover the vocabulary

01:00 (fixture time; no source video) · Source s00002

Let us start with a set, which removes duplicates. Converting the set into a list gives us a vocabulary we can index. The first version uses chars.index to find each character's position and stores those positions in a list. This is enough to encode our tiny text. Notice what the code on screen actually does: it searches the vocabulary again for every character, rather than preparing a lookup table once.

There is also a reproducibility problem. We have not said what order the vocabulary should use. A Python set does not promise a stable character ordering across runs, so token IDs from this version should not become a persistent file format. Do not memorize the particular IDs you happen to see. The same vocabulary ordering must be used wherever we encode and decode. We will fix that ordering before building anything on top of these IDs.

### Version 1 · vocabulary search

01:05 (fixture time; no source video) · e0001 · code · Authored fixture code state

```python
text = "ababa!"
chars = list(set(text))
encode = lambda s: [chars.index(c) for c in s]
ids = encode(text)
# Set ordering is not a persistent vocabulary contract.
```

## Make the mapping deterministic

02:00 (fixture time; no source video) · Source s00003

We now replace the vocabulary list with sorted(set(text)). For this corpus, the sorted list is exclamation mark, a, then b. Enumerating that list gives us a dictionary from each character to its integer ID: exclamation mark maps to zero, a to one, and b to two. This is the mapping visible on screen.

The encoder becomes a dictionary lookup for each character. Encoding ababa! therefore produces 1, 2, 1, 2, 1, 0, in that order. Compare this with the earlier version: the input has not changed, and we still produce one integer per character. What changed is how we choose the vocabulary ordering and how we perform each lookup. Sorting makes this example reproducible for the same character set. It does not make the IDs universal across datasets: adding another character can change the sorted ordering, so a trained model's vocabulary must be saved with it.

### Version 2 · deterministic lookup

02:10 (fixture time; no source video) · e0002 · code · Authored fixture code state

```python
text = "ababa!"
chars = sorted(set(text))
stoi = {ch: i for i, ch in enumerate(chars)}
encode = lambda s: [stoi[c] for c in s]
print(chars)
print(encode(text))
```

### Vocabulary and token IDs

02:30 (fixture time; no source video) · e0003 · terminal · Expected fixture output

```text
['!', 'a', 'b']
[1, 2, 1, 2, 1, 0]
```

## Build the inverse and check the round trip

03:00 (fixture time; no source video) · Source s00004

To recover text, invert the mapping. The integer-to-string dictionary maps zero to the exclamation mark, one to a, and two to b. For each input ID, look up its character, then join the resulting characters with an empty separator. A space separator would silently introduce characters that were never in the source.

Here is the first useful invariant: decode(encode(text)) must equal text. The terminal shows the encoded list followed by ababa!, and the assertion passes. This checks the composition of our encoder and decoder on the original example. It does not prove correctness for every possible string or ID, but it catches several common mistakes: mismatched dictionaries, reordered positions, and the wrong join separator. Keep the check beside the implementation as we change it. We have a reversible representation for strings made entirely from the current vocabulary.

### Add the inverse mapping

03:15 (fixture time; no source video) · e0004 · code · Authored fixture code addition

```python
itos = {i: ch for ch, i in stoi.items()}
decode = lambda ids: ''.join(itos[i] for i in ids)
print(decode(encode(text)))
assert decode(encode(text)) == text
```

### Round trip

03:40 (fixture time; no source video) · e0005 · terminal · Expected fixture output

```text
ababa!
# The assertion passes without printing anything.
```

## Expose the boundary instead of hiding it

04:00 (fixture time; no source video) · Source s00005

Now try to encode a question mark. Our corpus never contained one, so the string-to-integer dictionary has no entry for it. The first dictionary encoder raises a KeyError. This is an expected boundary of the implementation, not evidence that the mapping for ababa! stopped working.

A tempting response is to map an unknown character to zero. In our vocabulary, however, zero already means exclamation mark. That would make decoding a question mark return an exclamation mark, destroying the round-trip property without telling the caller. We will not make that substitution. For this lesson, we will reject unknown characters explicitly and report which character was missing. A production tokenizer could choose a different policy, but that policy would need a deliberately designed representation. The terminal error is part of the lesson: it explains why the next code change is necessary.

### Deliberately test an unknown character

04:15 (fixture time; no source video) · e0006 · code · Authored fixture demonstration; run separately

```python
encode("?")
# Raises KeyError: '?' with Version 2.
```

## Improve the error while preserving the contract

05:00 (fixture time; no source video) · Source s00006

Replace the small encoder expression with a named function. It still visits input characters in order and returns the same list for valid text. The difference is the boundary check: before looking up a character, test whether it belongs to the vocabulary. If not, raise a ValueError that includes the character's representation.

The terminal now shows ValueError: unknown character: '?' when we attempt the same unsupported input. This is a clearer message for a caller than a raw dictionary KeyError. We have changed the failure behavior, while preserving successful encodings. Run the original round-trip assertion again after replacing encode. It still passes. This is why we kept an invariant close to the code: the improvement to error handling should not accidentally change IDs, skip repeated characters, or return a partially encoded result. The function either returns the complete encoding or raises an exception.

### Version 3 · an explicit failure boundary

05:10 (fixture time; no source video) · e0007 · code · Authored fixture replacement for encode

```python
def encode(s):
    ids = []
    for c in s:
        if c not in stoi:
            raise ValueError(f"unknown character: {c!r}")
        ids.append(stoi[c])
    return ids

assert decode(encode(text)) == text
```

### The improved error

05:30 (fixture time; no source video) · e0008 · terminal · Expected fixture exception message; traceback omitted

```text
ValueError: unknown character: '?'
```

## Read the sequence as positions, not categories

06:00 (fixture time; no source video) · Source s00007

Look at the six boxes in the diagram. The top row contains a, b, a, b, a, exclamation mark. The bottom row contains 1, 2, 1, 2, 1, 0. A vertical arrow joins each character to exactly one ID at the same position. The repeated a characters occupy three different sequence positions but share the same vocabulary ID.

This distinction matters when the sequence later becomes model input. The list preserves the order of occurrences. The vocabulary dictionary stores the identity mapping, not the whole text. A set of the token IDs would throw away both repetitions and ordering, so it could not be decoded back into the original string. We also have not added a start token, an end token, padding, or a batch dimension. The exclamation mark is ordinary data in our example; it has no special control meaning merely because its ID is zero.

### Six positions, three vocabulary entries

06:05 (fixture time; no source video) · e0009 · diagram · Authored fixture diagram transcription

> Characters:   a   b   a   b   a   !
>               ↓   ↓   ↓   ↓   ↓   ↓
> Token IDs:    1   2   1   2   1   0
>
> Each vertical arrow preserves position. Repeated characters share an ID.

## Leave with a small, working boundary

07:00 (fixture time; no source video) · Source s00008

Run the complete file from top to bottom. It prints the vocabulary, the encoded sequence, and the decoded text. The round-trip assertion passes. A separate deliberate call with a question mark raises the explicit error; keep that call outside the successful main path when you want the file to finish normally.

We now have three pieces that must stay together: an ordered vocabulary, an encoder that rejects unsupported characters, and a decoder using the inverse vocabulary. The example remains small enough that we can inspect every value manually. We have not trained a language model, compressed the data, or discovered relationships between characters. We have only established a reversible numeric representation with a clear failure boundary. That is a useful stopping point: the next stage can consume these IDs without confusing a representation bug with a modeling problem. Save the vocabulary whenever you save data or weights that depend on its IDs.

### Complete runnable lesson

07:20 (fixture time; no source video) · e0010 · code · Authored fixture final state; earlier states remain above

```python
text = "ababa!"
chars = sorted(set(text))
stoi = {ch: i for i, ch in enumerate(chars)}
itos = {i: ch for ch, i in stoi.items()}

def encode(s):
    ids = []
    for c in s:
        if c not in stoi:
            raise ValueError(f"unknown character: {c!r}")
        ids.append(stoi[c])
    return ids

def decode(ids):
    return ''.join(itos[i] for i in ids)

print(chars)
print(encode(text))
print(decode(encode(text)))
assert decode(encode(text)) == text
# Run encode("?") separately to demonstrate the error.
```

## Fidelity report

- Source ID coverage: 8/8
- Chronological source assignment: passed
- Exact supplied code states: 6
- Supplied terminal records: 3
- Semantic fidelity: NOT VERIFIED

Coverage counts source IDs, not teaching points. Supplied visuals and code are retained verbatim; their transcription and semantic accuracy are not independently verified. The whole video has not been converted.
