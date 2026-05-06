import fs from 'node:fs';
import sax from 'sax';
import type {
  JmdictEntry,
  JmdictSense,
  JmdictExample,
} from '@shared/types/jmdict';

export interface ParseOptions {
  filePath: string;
  onEntry: (entry: JmdictEntry) => void;
  onProgress?: (entriesParsed: number) => void;
  /** How often to call `onProgress` (every Nth entry). Default 100. */
  progressEvery?: number;
}

const ENTITY_LITERAL_RE = /^&([A-Za-z0-9_-]+);$/;

function stripEntityIfLiteral(value: string): string {
  // sax (in lax mode) sometimes hands us `&n;` as raw text when an entity
  // wasn't pre-registered. Fall back to the entity name in that case.
  const m = value.match(ENTITY_LITERAL_RE);
  return m ? (m[1] ?? value) : value;
}

/**
 * Streams an uncompressed JMdict_e XML file. Calls `onEntry` for every
 * `<entry>` element encountered, then resolves with the total entry count.
 *
 * JMdict's DTD declares ~100 named entities for parts of speech (e.g. `&n;`
 * for noun). sax-js doesn't auto-register entity declarations from the
 * DOCTYPE, so we capture the DOCTYPE block, extract entity names from it,
 * and re-bind each entity to its short tag (`n`, `v5k`, `adj-i`, …) so that
 * sax substitutes it inline. As a belt-and-suspenders, we also fall back to
 * stripping a literal `&xxx;` if it slips through into text.
 */
export function parseJmdictStream(opts: ParseOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    // Lax mode: tolerate unknown entities by passing them through as text.
    const parser = sax.parser(false, { trim: true, normalize: true, lowercase: true });
    const PROGRESS_EVERY = opts.progressEvery ?? 100;

    let entriesParsed = 0;
    let inEntry = false;
    let currentEntry: JmdictEntry | null = null;
    let inKEle = false;
    let inREle = false;
    let inSense = false;
    let currentSense: JmdictSense | null = null;
    let inExample = false;
    let currentExample: JmdictExample | null = null;
    let textBuffer = '';
    let settled = false;

    const finish = (resolveValue: number) => {
      if (settled) return;
      settled = true;
      resolve(resolveValue);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    parser.ondoctype = (doctype: string) => {
      const entityRegex = /<!ENTITY\s+(\S+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
      const entitiesRecord = (parser as unknown as {
        ENTITIES: Record<string, string>;
      }).ENTITIES;
      let match;
      let count = 0;
      while ((match = entityRegex.exec(doctype)) !== null) {
        const name = match[1];
        if (name) {
          // Re-bind to the short tag rather than the long description.
          entitiesRecord[name] = name;
          count += 1;
        }
      }
      console.log(`[jmdict-parser] DOCTYPE seen, registered ${count} entities`);
    };

    parser.onopentag = (node) => {
      const name = node.name;
      if (name === 'entry') {
        inEntry = true;
        currentEntry = { entSeq: 0, kanji: [], readings: [], senses: [] };
        textBuffer = '';
        return;
      }
      if (!inEntry) return;
      if (name === 'k_ele') inKEle = true;
      else if (name === 'r_ele') inREle = true;
      else if (name === 'sense') {
        inSense = true;
        currentSense = { pos: [], glosses: [] };
      } else if (name === 'example' && currentSense) {
        inExample = true;
        currentExample = { japanese: '', translations: [] };
      }
      textBuffer = '';
    };

    parser.ontext = (text) => {
      if (inEntry) textBuffer += text;
    };

    parser.onclosetag = (name) => {
      if (name === 'entry') {
        if (currentEntry) {
          opts.onEntry(currentEntry);
          entriesParsed += 1;
          if (entriesParsed % PROGRESS_EVERY === 0) {
            opts.onProgress?.(entriesParsed);
          }
        }
        currentEntry = null;
        inEntry = false;
        textBuffer = '';
        return;
      }

      if (!inEntry || !currentEntry) {
        textBuffer = '';
        return;
      }

      const value = textBuffer.trim();
      textBuffer = '';

      if (name === 'ent_seq') {
        currentEntry.entSeq = Number(value);
      } else if (name === 'keb' && inKEle) {
        if (value) currentEntry.kanji.push(value);
      } else if (name === 'reb' && inREle) {
        if (value) currentEntry.readings.push(value);
      } else if (name === 'pos' && inSense && currentSense) {
        if (value) currentSense.pos.push(stripEntityIfLiteral(value));
      } else if (name === 'gloss' && inSense && currentSense) {
        if (value) currentSense.glosses.push(value);
      } else if (name === 'ex_text' && inExample && currentExample) {
        if (value) currentExample.japanese = value;
      } else if (name === 'ex_sent' && inExample && currentExample) {
        if (value) currentExample.translations.push(value);
      } else if (name === 'example' && currentSense && currentExample) {
        if (currentExample.japanese) {
          if (!currentSense.examples) currentSense.examples = [];
          currentSense.examples.push(currentExample);
        }
        currentExample = null;
        inExample = false;
      } else if (name === 'k_ele') {
        inKEle = false;
      } else if (name === 'r_ele') {
        inREle = false;
      } else if (name === 'sense') {
        if (currentSense) currentEntry.senses.push(currentSense);
        currentSense = null;
        inSense = false;
      }
    };

    parser.onerror = (err) => {
      // In lax mode sax recovers from many issues; log non-fatally and clear.
      console.warn('[jmdict-parser] sax warning:', err.message);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parser as any).error = null;
      parser.resume();
    };

    parser.onend = () => {
      opts.onProgress?.(entriesParsed);
      console.log(`[jmdict-parser] done, ${entriesParsed} entries`);
      finish(entriesParsed);
    };

    const stream = fs.createReadStream(opts.filePath, { encoding: 'utf-8' });
    let bytesRead = 0;
    let firstChunkLogged = false;

    stream.on('data', (chunk) => {
      const text = chunk as string;
      bytesRead += text.length;
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        console.log(`[jmdict-parser] first chunk, ${text.length} chars`);
      }
      try {
        parser.write(text);
      } catch (err) {
        fail(err);
        stream.destroy();
      }
    });
    stream.on('end', () => {
      console.log(`[jmdict-parser] stream end, ${bytesRead} chars total`);
      try {
        parser.close();
      } catch (err) {
        fail(err);
      }
    });
    stream.on('error', (err) => fail(err));
  });
}
