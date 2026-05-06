import type { Token } from '@shared/types/tokenizer';

// kuromoji's POS strings come back in Japanese. Map the relevant ones
// (and their conjugation classes / forms) to short English labels that
// match how Japanese textbooks describe them.

const POS_LABEL: Record<string, string> = {
  名詞: 'noun',
  動詞: 'verb',
  形容詞: 'i-adjective',
  形容動詞: 'na-adjective',
  副詞: 'adverb',
  助詞: 'particle',
  助動詞: 'auxiliary',
  接続詞: 'conjunction',
  連体詞: 'pre-noun adjectival',
  感動詞: 'interjection',
  記号: 'symbol',
  接頭詞: 'prefix',
  フィラー: 'filler',
};

const FORM_LABEL: Record<string, string> = {
  基本形: 'dictionary form',
  未然形: 'irrealis (negative stem)',
  '未然ウ接続': 'volitional stem',
  連用形: 'continuative stem',
  '連用タ接続': 'past-tense stem',
  '連用テ接続': 'te-form stem',
  仮定形: 'hypothetical (-eba)',
  命令ｅ: 'imperative',
  命令ｉ: 'imperative',
  命令ｒｏ: 'imperative',
  '命令ｙｏ': 'imperative',
  連体形: 'attributive',
  体言接続: 'attributive',
  '連用ニ接続': 'adverbial (ni-form)',
  '連用ゴザイ接続': 'gozaimasu stem',
  '連用デ接続': 'de-form stem',
  音便基本形: 'euphonic base',
};

const CONJ_TYPE_LABEL: Record<string, string> = {
  一段: 'ichidan verb (-ru)',
  '五段・カ行イ音便': 'godan verb (-ku)',
  '五段・カ行促音便': 'godan verb (-ku)',
  '五段・ガ行': 'godan verb (-gu)',
  '五段・サ行': 'godan verb (-su)',
  '五段・タ行': 'godan verb (-tsu)',
  '五段・ナ行': 'godan verb (-nu)',
  '五段・バ行': 'godan verb (-bu)',
  '五段・マ行': 'godan verb (-mu)',
  '五段・ラ行': 'godan verb (-ru)',
  '五段・ラ行特殊': 'godan verb (-ru, special)',
  '五段・ワ行ウ音便': 'godan verb (-u)',
  '五段・ワ行促音便': 'godan verb (-u)',
  'カ変・来ル': 'irregular (kuru)',
  'サ変・スル': 'suru verb',
  'サ変・−スル': 'suru verb',
  'サ変・−ズル': 'zuru verb',
  '形容詞・アウオ段': 'i-adjective',
  '形容詞・イ段': 'i-adjective',
  '形容詞・イイ': 'i-adjective',
  特殊: 'irregular',
};

// Short tags used by JMdict's <pos> entities, mapped to English.
const JMDICT_POS_LABEL: Record<string, string> = {
  n: 'noun',
  'n-suf': 'noun, used as a suffix',
  'n-pref': 'noun, used as a prefix',
  pn: 'pronoun',
  'adj-i': 'i-adjective',
  'adj-na': 'na-adjective',
  'adj-no': 'no-adjective',
  'adj-pn': 'pre-noun adjectival',
  adv: 'adverb',
  'adv-to': 'adverb taking と',
  v1: 'ichidan verb',
  v5: 'godan verb',
  'v5k': 'godan verb (-ku)',
  'v5g': 'godan verb (-gu)',
  'v5s': 'godan verb (-su)',
  'v5t': 'godan verb (-tsu)',
  'v5n': 'godan verb (-nu)',
  'v5b': 'godan verb (-bu)',
  'v5m': 'godan verb (-mu)',
  'v5r': 'godan verb (-ru)',
  'v5u': 'godan verb (-u)',
  'v5k-s': 'godan verb (-ku, special)',
  'v5r-i': 'godan verb (-ru, irregular)',
  'v5aru': 'godan verb (-aru)',
  vk: 'kuru verb',
  vs: 'suru verb',
  'vs-i': 'irregular suru verb',
  'vs-s': 'suru verb (special)',
  vi: 'intransitive verb',
  vt: 'transitive verb',
  exp: 'expression',
  prt: 'particle',
  conj: 'conjunction',
  int: 'interjection',
  aux: 'auxiliary',
  'aux-v': 'auxiliary verb',
  'aux-adj': 'auxiliary adjective',
  cop: 'copula',
  ctr: 'counter',
  num: 'numeric',
  pref: 'prefix',
  suf: 'suffix',
};

export function labelPos(jp: string): string {
  return POS_LABEL[jp] ?? jp;
}

export function labelJmdictPos(tag: string): string {
  return JMDICT_POS_LABEL[tag] ?? tag;
}

export function labelConjType(type: string | null): string | null {
  if (!type) return null;
  return CONJ_TYPE_LABEL[type] ?? type;
}

export function labelConjForm(form: string | null): string | null {
  if (!form) return null;
  return FORM_LABEL[form] ?? form;
}

/**
 * Token kinds we never want to surface in the lookup panel — particles,
 * symbols, whitespace, and ascii noise. (Particles are still tokens we
 * render in-line, but clicking them doesn't open the panel.)
 */
export function isLookupSkippable(token: Token): boolean {
  if (!token.surface.trim()) return true;
  if (token.pos === '記号') return true;       // punctuation
  if (token.pos === '助詞') return true;       // particles
  if (token.pos === '助動詞') return true;     // auxiliary verbs (です, ます, etc. — handled by the verb they attach to)
  if (token.pos === 'フィラー') return true;
  return false;
}

export interface ConjugationSummary {
  basicForm: string;
  posLabel: string;
  conjTypeLabel: string | null;
  conjFormLabel: string | null;
  /** True if the token is in a non-dictionary form. */
  isInflected: boolean;
}

export function summarizeConjugation(token: Token): ConjugationSummary {
  return {
    basicForm: token.basicForm,
    posLabel: labelPos(token.pos),
    conjTypeLabel: labelConjType(token.conjugatedType),
    conjFormLabel: labelConjForm(token.conjugatedForm),
    isInflected:
      Boolean(token.conjugatedForm) &&
      token.conjugatedForm !== '基本形' &&
      token.basicForm !== token.surface,
  };
}
