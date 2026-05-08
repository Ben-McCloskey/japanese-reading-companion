import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createEventReplayer } from './event-replay';
import type { JmdictEntry } from '@shared/types/jmdict';
import type { SyncEvent } from '@shared/types/sync';

// The integration test that uses a real :memory: better-sqlite3 DB lives
// outside the vitest run (better-sqlite3 is built against Electron, not
// node). Here we stub the repos and verify the replayer's dispatch logic:
// each event kind reaches the right repo/service with the right args.

interface MockWord {
  id: number;
  surface: string;
  reading: string;
}

function fakeDb() {
  const sessionsByRawText = new Map<string, number>();
  return {
    sessionsByRawText,
    obj: {
      transaction:
        // We don't need real transactions — just invoke the callback inline.
        (fn: (...args: unknown[]) => unknown) =>
        (...args: unknown[]) =>
          fn(...args),
      prepare: () => ({
        get: ({ raw_text }: { raw_text: string }) => {
          const id = sessionsByRawText.get(raw_text);
          return id != null ? { id } : undefined;
        },
        all: () => [],
        run: () => ({ changes: 0 }),
      }),
    } as never,
  };
}

function makeReplayer() {
  const db = fakeDb();

  const words = new Map<string, MockWord>();
  let nextWordId = 1;

  const wordsRepo = {
    upsert: vi.fn(),
    getByKey: vi.fn((s: string, r: string) => words.get(`${s}|${r}`) ?? null),
    getById: vi.fn((id: number) => {
      for (const w of words.values()) if (w.id === id) return w;
      return null;
    }),
    remove: vi.fn(),
    list: vi.fn(),
    bulkRemove: vi.fn((ids: number[]) => {
      for (const id of ids) {
        for (const [k, w] of words) if (w.id === id) words.delete(k);
      }
      return ids.length;
    }),
    bulkMarkKnown: vi.fn((ids: number[]) => ids.length),
  };

  const settings = {
    get: vi.fn(),
    set: vi.fn(),
  };

  const sessions = {
    saveOrReuse: vi.fn(({ rawText }: { rawText: string }) => {
      const existing = db.sessionsByRawText.get(rawText);
      if (existing != null) return existing;
      const id = db.sessionsByRawText.size + 1;
      db.sessionsByRawText.set(rawText, id);
      return id;
    }),
    list: vi.fn(() => []),
    listWithStats: vi.fn(),
    get: vi.fn(),
    remove: vi.fn((id: number) => {
      for (const [k, v] of db.sessionsByRawText) {
        if (v === id) db.sessionsByRawText.delete(k);
      }
    }),
  };

  const srs = {
    markNew: vi.fn(),
    markKnown: vi.fn(),
    getByWord: vi.fn(() => null),
    getForKey: vi.fn(),
    getForKeys: vi.fn(),
    getDueQueue: vi.fn(),
    applyPatchSync: vi.fn(),
    remove: vi.fn(),
  };

  const reviews = { log: vi.fn() };

  const deck = {
    addWord: vi.fn(
      ({ surface, reading }: { surface: string; reading: string }) => {
        const id = nextWordId++;
        words.set(`${surface}|${reading}`, { id, surface, reading });
        return null;
      },
    ),
    removeWord: vi.fn((surface: string, reading: string) => {
      words.delete(`${surface}|${reading}`);
    }),
    state: vi.fn(),
    statesBatch: vi.fn(),
  };

  const appearances = {
    syncForSession: vi.fn(),
    syncForNewWord: vi.fn(),
  };

  const replayer = createEventReplayer({
    // Cast away the type since fakeDb is a structural stub.
    db: db.obj,
    settings: settings as never,
    words: wordsRepo as never,
    sessions: sessions as never,
    srs: srs as never,
    reviews: reviews as never,
    deck: deck as never,
    appearances: appearances as never,
  });

  return {
    replayer,
    deck,
    sessions,
    settings,
    srs,
    reviews,
    words: wordsRepo,
    appearances,
    db,
  };
}

const sampleEntry: JmdictEntry = {
  entSeq: 1234567,
  kanji: ['食べる'],
  readings: ['たべる'],
  senses: [{ pos: ['v1'], glosses: ['to eat'] }],
};

function event(kind: SyncEvent['kind'], payload: unknown): SyncEvent {
  return {
    id: `2026-05-07T00:00:00.000Z-${Math.random().toString(36).slice(2)}`,
    deviceId: 'peer-A',
    ts: '2026-05-07T00:00:00.000Z',
    kind,
    payload,
  } as SyncEvent;
}

describe('event-replay dispatch', () => {
  let r: ReturnType<typeof makeReplayer>;

  beforeEach(() => {
    r = makeReplayer();
  });

  it('word.add reaches deck.addWord with natural-key fields', () => {
    r.replayer.apply(
      event('word.add', {
        surface: '食べる',
        reading: 'たべる',
        jlptLevel: 5,
        pos: 'v1',
        meanings: [sampleEntry],
        firstSentence: null,
        firstSessionRawText: null,
        asKnown: false,
      }),
    );
    expect(r.deck.addWord).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: '食べる',
        reading: 'たべる',
        firstSessionId: null,
      }),
    );
  });

  it('word.add resolves session id by raw_text', () => {
    r.db.sessionsByRawText.set('元のテキスト', 42);
    r.replayer.apply(
      event('word.add', {
        surface: '食べる',
        reading: 'たべる',
        jlptLevel: 5,
        pos: 'v1',
        meanings: [sampleEntry],
        firstSentence: null,
        firstSessionRawText: '元のテキスト',
        asKnown: false,
      }),
    );
    expect(r.deck.addWord).toHaveBeenCalledWith(
      expect.objectContaining({ firstSessionId: 42 }),
    );
  });

  it('word.add forwards asKnown when true', () => {
    r.replayer.apply(
      event('word.add', {
        surface: '飲む',
        reading: 'のむ',
        jlptLevel: 5,
        pos: 'v5m',
        meanings: [sampleEntry],
        firstSentence: null,
        firstSessionRawText: null,
        asKnown: true,
      }),
    );
    expect(r.deck.addWord).toHaveBeenCalledWith(
      expect.objectContaining({ asKnown: true }),
    );
  });

  it('word.remove reaches deck.removeWord', () => {
    r.replayer.apply(
      event('word.remove', { surface: '食べる', reading: 'たべる' }),
    );
    expect(r.deck.removeWord).toHaveBeenCalledWith('食べる', 'たべる');
  });

  it('review.submit applies SRS state and logs review when word exists', () => {
    // Seed the word so getByKey returns something.
    r.replayer.apply(
      event('word.add', {
        surface: '食べる',
        reading: 'たべる',
        jlptLevel: 5,
        pos: 'v1',
        meanings: [sampleEntry],
        firstSentence: null,
        firstSessionRawText: null,
        asKnown: false,
      }),
    );

    r.replayer.apply(
      event('review.submit', {
        word: { surface: '食べる', reading: 'たべる' },
        rating: 3,
        reviewedAt: '2026-05-08T12:00:00.000Z',
        result: {
          state: 'review',
          dueDate: '2026-05-15T12:00:00.000Z',
          stability: 7,
          difficulty: 5,
          reviewCount: 1,
          lapseCount: 0,
          intervalBefore: null,
          intervalAfter: 7,
          stabilityBefore: 0,
          stabilityAfter: 7,
        },
      }),
    );

    expect(r.srs.applyPatchSync).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'review',
        dueDate: '2026-05-15T12:00:00.000Z',
        reviewCount: 1,
      }),
    );
    expect(r.reviews.log).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 3,
        reviewed_at: '2026-05-08T12:00:00.000Z',
      }),
    );
  });

  it('review.submit silently skips when the word is not yet replicated', () => {
    r.replayer.apply(
      event('review.submit', {
        word: { surface: 'まだない', reading: 'まだない' },
        rating: 3,
        reviewedAt: '2026-05-08T12:00:00.000Z',
        result: {
          state: 'review',
          dueDate: '2026-05-15T12:00:00.000Z',
          stability: 7,
          difficulty: 5,
          reviewCount: 1,
          lapseCount: 0,
          intervalBefore: null,
          intervalAfter: 7,
          stabilityBefore: 0,
          stabilityAfter: 7,
        },
      }),
    );
    expect(r.srs.applyPatchSync).not.toHaveBeenCalled();
    expect(r.reviews.log).not.toHaveBeenCalled();
  });

  it('session.save reaches sessions.saveOrReuse and tallies appearances', () => {
    const tokens = [
      {
        surface: '食べる',
        basicForm: '食べる',
        reading: 'タベル',
        pos: '動詞',
        posDetail: [],
        conjugatedType: null,
        conjugatedForm: null,
      },
    ];
    r.replayer.apply(
      event('session.save', {
        rawText: '食べる',
        tokens,
        createdAt: '2026-05-08T00:00:00.000Z',
      }),
    );
    expect(r.sessions.saveOrReuse).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: '食べる' }),
    );
    expect(r.appearances.syncForSession).toHaveBeenCalled();
  });

  it('session.delete looks up id by raw_text and removes', () => {
    r.db.sessionsByRawText.set('消すやつ', 7);
    r.replayer.apply(event('session.delete', { rawText: '消すやつ' }));
    expect(r.sessions.remove).toHaveBeenCalledWith(7);
  });

  it('session.delete is a no-op when raw_text not found', () => {
    r.replayer.apply(event('session.delete', { rawText: '存在しない' }));
    expect(r.sessions.remove).not.toHaveBeenCalled();
  });

  it('settings.set applies synced keys', () => {
    r.replayer.apply(
      event('settings.set', { key: 'theme', value: 'dark' }),
    );
    expect(r.settings.set).toHaveBeenCalledWith('theme', 'dark');
  });

  it('settings.set ignores non-synced keys (defense in depth)', () => {
    r.replayer.apply(
      event('settings.set', { key: 'reviewsDoneCount', value: '99' }),
    );
    expect(r.settings.set).not.toHaveBeenCalled();
  });

  it('bulk-mark-known resolves keys to local ids', () => {
    // Seed two words and capture their ids.
    for (const [surface, reading] of [
      ['食べる', 'たべる'],
      ['飲む', 'のむ'],
    ]) {
      r.replayer.apply(
        event('word.add', {
          surface,
          reading,
          jlptLevel: 5,
          pos: 'v1',
          meanings: [sampleEntry],
          firstSentence: null,
          firstSessionRawText: null,
          asKnown: false,
        }),
      );
    }

    r.replayer.apply(
      event('words.bulk-mark-known', {
        keys: [
          { surface: '食べる', reading: 'たべる' },
          { surface: '飲む', reading: 'のむ' },
        ],
      }),
    );
    expect(r.words.bulkMarkKnown).toHaveBeenCalledWith([1, 2]);
  });

  it('bulk-delete resolves keys to local ids', () => {
    r.replayer.apply(
      event('word.add', {
        surface: '食べる',
        reading: 'たべる',
        jlptLevel: 5,
        pos: 'v1',
        meanings: [sampleEntry],
        firstSentence: null,
        firstSessionRawText: null,
        asKnown: false,
      }),
    );
    r.replayer.apply(
      event('words.bulk-delete', {
        keys: [{ surface: '食べる', reading: 'たべる' }],
      }),
    );
    expect(r.words.bulkRemove).toHaveBeenCalledWith([1]);
  });

  it('bulk operations skip missing keys without error', () => {
    r.replayer.apply(
      event('words.bulk-delete', {
        keys: [{ surface: 'missing', reading: 'missing' }],
      }),
    );
    expect(r.words.bulkRemove).not.toHaveBeenCalled();
  });
});
