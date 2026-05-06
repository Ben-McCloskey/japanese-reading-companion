export interface JmdictExample {
  japanese: string;
  translations: string[];
}

export interface JmdictSense {
  pos: string[];
  glosses: string[];
  examples?: JmdictExample[];
}

export interface JmdictEntry {
  entSeq: number;
  kanji: string[];
  readings: string[];
  senses: JmdictSense[];
}
