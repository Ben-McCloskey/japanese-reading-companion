import type { SrsState } from '@shared/types/deck';

/**
 * Each SRS state maps to a soft underline color and an English label used in
 * the lookup panel. Colors are deliberately muted so a sentence with a mix of
 * known/unknown words doesn't read like a Christmas tree.
 */
export const SRS_LABEL: Record<SrsState, string> = {
  new: 'new',
  learning: 'learning',
  review: 'review',
  lapsed: 'lapsed',
  known: 'known',
};

export const SRS_UNDERLINE: Record<SrsState, string> = {
  new: 'srs-underline srs-learning',
  learning: 'srs-underline srs-learning',
  review: 'srs-underline srs-learning',
  lapsed: 'srs-underline srs-lapsed',
  known: 'srs-underline srs-known',
};

export const SRS_DOT: Record<SrsState, string> = {
  new: 'bg-[hsl(var(--srs-learning))]',
  learning: 'bg-[hsl(var(--srs-learning))]',
  review: 'bg-[hsl(var(--srs-learning))]',
  lapsed: 'bg-[hsl(var(--srs-lapsed))]',
  known: 'bg-[hsl(var(--srs-known))]',
};
