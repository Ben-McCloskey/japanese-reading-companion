const KANJI_RE = /[一-鿿㐀-䶿]/;

export function hasKanji(text: string): boolean {
  return KANJI_RE.test(text);
}

/** Convert a katakana string to hiragana. Non-katakana chars are passed through. */
export function katakanaToHiragana(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    // Katakana block (excluding the long-vowel mark and special chars at the edges)
    if (code >= 0x30a1 && code <= 0x30f6) {
      out += String.fromCharCode(code - 0x60);
    } else {
      out += input.charAt(i);
    }
  }
  return out;
}
