import { useEffect, useState } from 'react';

const PREF_KEY = 'ttsVoice';
const RATE = 0.85;

export type VoiceQuality = 'premium' | 'enhanced' | 'standard';

export interface JapaneseVoice {
  uri: string;
  name: string;
  lang: string;
  quality: VoiceQuality;
  voice: SpeechSynthesisVoice;
}

export type TtsAvailability =
  | { kind: 'ready'; voice: SpeechSynthesisVoice; voices: JapaneseVoice[] }
  | { kind: 'unsupported' }
  | { kind: 'no-japanese-voice' }
  | { kind: 'loading' };

// ---- module-level state -----------------------------------------------

let preferredUri: string | null = null;
let preferredLoaded = false;
const subs = new Set<() => void>();

function notify() {
  for (const fn of subs) fn();
}

async function loadPreferred(): Promise<void> {
  if (preferredLoaded) return;
  preferredLoaded = true;
  const res = await window.api.getSetting(PREF_KEY);
  if (res.ok && res.data) preferredUri = res.data;
  notify();
}

export function setPreferredVoiceUri(uri: string | null): void {
  preferredUri = uri;
  void window.api.setSetting(PREF_KEY, uri ?? '');
  notify();
}

// ---- helpers ----------------------------------------------------------

function classifyQuality(v: SpeechSynthesisVoice): VoiceQuality {
  const u = v.voiceURI.toLowerCase();
  if (u.includes('premium')) return 'premium';
  if (u.includes('enhanced')) return 'enhanced';
  return 'standard';
}

const QUALITY_ORDER: Record<VoiceQuality, number> = {
  premium: 0,
  enhanced: 1,
  standard: 2,
};

function listJapaneseVoices(): JapaneseVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.startsWith('ja'))
    .map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      quality: classifyQuality(v),
      voice: v,
    }))
    .sort((a, b) => {
      const o = QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality];
      if (o !== 0) return o;
      return a.name.localeCompare(b.name);
    });
}

function pickVoice(voices: JapaneseVoice[]): JapaneseVoice | null {
  if (voices.length === 0) return null;
  if (preferredUri) {
    const match = voices.find((v) => v.uri === preferredUri);
    if (match) return match;
  }
  return voices[0] ?? null;
}

// ---- hooks ------------------------------------------------------------

export function useTts(): TtsAvailability {
  const [state, setState] = useState<TtsAvailability>(() =>
    'speechSynthesis' in window
      ? { kind: 'loading' }
      : { kind: 'unsupported' },
  );

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      setState({ kind: 'unsupported' });
      return;
    }
    const recompute = () => {
      const voices = listJapaneseVoices();
      if (voices.length === 0) {
        setState({ kind: 'no-japanese-voice' });
        return;
      }
      const chosen = pickVoice(voices);
      if (!chosen) {
        setState({ kind: 'no-japanese-voice' });
        return;
      }
      setState({ kind: 'ready', voice: chosen.voice, voices });
    };

    void loadPreferred().then(recompute);
    speechSynthesis.addEventListener('voiceschanged', recompute);
    // macOS sometimes fills the voices list a beat late.
    const t = window.setTimeout(recompute, 250);
    subs.add(recompute);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', recompute);
      window.clearTimeout(t);
      subs.delete(recompute);
    };
  }, []);

  return state;
}

// ---- speaking ---------------------------------------------------------

export function speakJapanese(
  text: string,
  voiceOverride?: SpeechSynthesisVoice,
): void {
  if (!('speechSynthesis' in window)) return;
  const voice = voiceOverride ?? pickVoice(listJapaneseVoices())?.voice ?? null;
  if (!voice) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = RATE;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
