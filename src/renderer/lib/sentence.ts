import type { Token } from '@shared/types/tokenizer';

const TERMINATORS = new Set(['。', '！', '？', '．', '\n', '\r']);

/**
 * Returns the contiguous run of token surface forms surrounding the given
 * index, bounded by Japanese sentence terminators or hard newlines. Used to
 * capture the source sentence at the moment a word is added to the deck.
 */
export function sentenceAt(tokens: Token[], index: number): string {
  if (index < 0 || index >= tokens.length) return '';

  let start = index;
  while (start > 0) {
    const prev = tokens[start - 1];
    if (!prev || isTerminator(prev.surface)) break;
    start -= 1;
  }

  let end = index;
  while (end < tokens.length) {
    const tok = tokens[end];
    if (!tok || isTerminator(tok.surface)) break;
    end += 1;
  }

  return tokens
    .slice(start, end + 1)
    .map((t) => t.surface)
    .join('')
    .trim();
}

function isTerminator(surface: string): boolean {
  return TERMINATORS.has(surface);
}
