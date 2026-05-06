import type { Token } from './tokenizer';

export interface SessionListItem {
  id: number;
  createdAt: string;
  title: string;
  rawText: string;
  /** Number of words first encountered in this session — captured at deck-add. */
  newWordsCount: number;
}

export interface SessionDetail {
  id: number;
  createdAt: string;
  title: string;
  rawText: string;
  tokens: Token[];
}
