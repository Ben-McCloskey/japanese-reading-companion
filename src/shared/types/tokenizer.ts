export interface Token {
  surface: string;        // surface form as it appears in the input
  basicForm: string;      // dictionary form (kuromoji's basic_form)
  reading: string | null; // katakana reading from kuromoji
  pos: string;            // top-level POS (e.g. '名詞', '動詞')
  posDetail: string[];    // sub-POS detail array
  conjugatedType: string | null;
  conjugatedForm: string | null;
}
