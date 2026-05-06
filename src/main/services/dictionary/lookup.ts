import type { JmdictRepo } from '@main/db/repos/jmdict-repo';
import type { JlptRepo } from '@main/db/repos/jlpt-repo';
import type { WordLookupHit, WordLookupRequest } from '@shared/ipc';

function katakanaToHiragana(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60);
    else out += s.charAt(i);
  }
  return out;
}

/**
 * Look a word up in JMdict, trying the dictionary form first, then surface,
 * then reading (converted from katakana to hiragana). Returns the first key
 * that yields any entries. JLPT level is resolved against the same key chain.
 */
export function lookupWord(
  req: WordLookupRequest,
  deps: { jmdict: JmdictRepo; jlpt: JlptRepo },
): WordLookupHit | null {
  const candidates: string[] = [];
  if (req.basicForm) candidates.push(req.basicForm);
  if (req.surface && req.surface !== req.basicForm) candidates.push(req.surface);
  if (req.reading) {
    const hira = katakanaToHiragana(req.reading);
    if (!candidates.includes(hira)) candidates.push(hira);
  }

  for (const key of candidates) {
    const entries = deps.jmdict.lookup(key);
    if (entries.length > 0) {
      const jlptLevel =
        deps.jlpt.levelFor(key) ??
        (req.reading ? deps.jlpt.levelFor(katakanaToHiragana(req.reading)) : null);
      return { matchedKey: key, entries, jlptLevel };
    }
  }
  return null;
}
