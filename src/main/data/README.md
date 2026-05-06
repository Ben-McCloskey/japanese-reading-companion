# Bundled data

## `jlpt-levels.json`

A list of `{ "key": "<surface or reading>", "level": <1-5> }` objects. Used by
the lookup panel to show a JLPT badge.

JMdict does not include JLPT levels. To populate badges, either:

1. Replace this file with a public JLPT vocab list (key = kanji surface or kana
   reading, level = JLPT N-level as 1..5 — note: 1 is hardest, 5 is easiest).
2. Or drop a `jlpt-levels.json` of the same shape into the app's userData
   directory; the importer prefers the userData copy when present.

The schema:

```jsonc
[
  { "key": "食べる", "level": 5 },
  { "key": "たべる", "level": 5 },
  { "key": "結局", "level": 3 }
]
```

The importer treats both surface and reading as separate keys; provide both
forms when possible so kana-only writings still resolve.
