import path from 'node:path';
import { app } from 'electron';
import kuromoji from 'kuromoji';
import type { Token } from '@shared/types/tokenizer';

type KuromojiTokenizer = kuromoji.Tokenizer<kuromoji.IpadicFeatures>;

interface TokenizerService {
  ready: Promise<void>;
  isReady(): boolean;
  failure(): string | null;
  tokenize(text: string): Token[];
}

function resolveDicPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'kuromoji-dict');
  }
  // In dev, kuromoji's dict ships in node_modules. The bundled main file
  // lives at <project>/out/main/index.js, so two levels up reaches the project root.
  return path.resolve(__dirname, '..', '..', 'node_modules', 'kuromoji', 'dict');
}

function mapToken(t: kuromoji.IpadicFeatures): Token {
  const reading = t.reading && t.reading !== '*' ? t.reading : null;
  const basicForm =
    t.basic_form && t.basic_form !== '*' ? t.basic_form : t.surface_form;

  const detail = [t.pos_detail_1, t.pos_detail_2, t.pos_detail_3].filter(
    (d): d is string => Boolean(d) && d !== '*',
  );

  return {
    surface: t.surface_form,
    basicForm,
    reading,
    pos: t.pos,
    posDetail: detail,
    conjugatedType:
      t.conjugated_type && t.conjugated_type !== '*' ? t.conjugated_type : null,
    conjugatedForm:
      t.conjugated_form && t.conjugated_form !== '*' ? t.conjugated_form : null,
  };
}

export function createTokenizerService(): TokenizerService {
  let tokenizer: KuromojiTokenizer | null = null;
  let failureMessage: string | null = null;

  const ready = new Promise<void>((resolve) => {
    const dicPath = resolveDicPath();
    kuromoji
      .builder({ dicPath })
      .build((err, t) => {
        if (err) {
          failureMessage = err instanceof Error ? err.message : String(err);
          console.error('[tokenizer] failed to load:', failureMessage);
          resolve();
          return;
        }
        tokenizer = t;
        console.log('[tokenizer] ready');
        resolve();
      });
  });

  return {
    ready,
    isReady: () => tokenizer !== null,
    failure: () => failureMessage,
    tokenize(text) {
      if (!tokenizer) throw new Error('Tokenizer is not ready');
      return tokenizer.tokenize(text).map(mapToken);
    },
  };
}

export type { TokenizerService };
