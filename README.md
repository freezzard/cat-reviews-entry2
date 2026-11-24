# Cat Reviews Its Human — make.fun entry

One funny single-line one-star review from a house cat about its human,
written by `main.ts` to `/output/entry.txt`.

## The review

The program assembles the review from fixed drafts with a deterministic
chooser (seed `cat-reviews-entry2`), so every run writes the same bytes:
a deadpan one-star complaint about the laptop keyboard, with the sting
in the last few words. The output is a single line of 163 characters,
inside the competition gate of 1 to 200 characters.

## Run

```sh
node main.ts
```

Requires Node 22 or newer. No network, no secrets, no input files.
The program checks the gate conditions itself (length, single line,
non-blank, no surrounding space) before it writes.

## Determinism

Two consecutive runs produce byte-identical output:

- sha256 of `/output/entry.txt`:
  `2cd85e76720ef2d3875dddbb6ba6e16dcb81503e3711ba3865362d5e99b24f6e`

## Competition

- Slug: `u-motasimfuad-make-the-ai-judge-laugh-cat-reviews-its-42a34990`
- Harness: program/v1, judge z-ai/glm-5.3-flash, 3 blind rounds
- Prize pool: $2 USDC, escrowed onchain
