// A status you put up over your character's head, like "☕ BRB" or "📅 In a meeting": an emoji and a
// few words, until you clear it. Server and client share the rules, so both cut it down the same way.

export interface PeerStatus {
  /** One emoji (a single character as it's drawn, skin tones and all), or '' for none. */
  emoji: string;
  /** A few words, or '' for just the emoji. */
  text: string;
}

/** How long the words can be, in characters as they're drawn. */
export const STATUS_TEXT_MAX = 40;

/** The ones a click away. */
export const STATUS_PRESETS: readonly PeerStatus[] = [
  { emoji: '☕', text: 'BRB' },
  { emoji: '🍔', text: 'Out to lunch' },
  { emoji: '📅', text: 'In a meeting' },
  { emoji: '🎧', text: 'Heads down' },
  { emoji: '🚶', text: 'Away' },
  { emoji: '🏠', text: 'Done for the day' },
];

/** The emoji to pick from (you can paste any other). */
export const STATUS_EMOJIS = ['☕', '🍔', '📅', '🎧', '🚶', '🏠', '💤', '🤒', '🌴', '🔕', '🧠', '🚀', '🔥', '🎉', '👀', '🐛'] as const;

/** What someone typed, as characters as they're drawn (an emoji with a skin tone is one). */
function graphemes(s: string): string[] {
  const Seg = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!Seg) return Array.from(s);
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (g) => g.segment);
}

/** Control characters and line breaks out, runs of spaces down to one. */
const tidy = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();

/** A status from anywhere (the wire, localStorage) as the office keeps it, or undefined for none. */
export function sanitizeStatus(v: unknown): PeerStatus | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const rawEmoji = typeof o.emoji === 'string' ? tidy(o.emoji.slice(0, 64)) : '';
  const rawText = typeof o.text === 'string' ? tidy(o.text.slice(0, STATUS_TEXT_MAX * 8)) : '';
  // One emoji at most, and nothing that's just letters: a status's emoji is a picture, not a word.
  const first = graphemes(rawEmoji)[0] ?? '';
  const emoji = first.length <= 16 && !/^[\p{L}\p{N}\p{P}\s]+$/u.test(first) ? first : '';
  const text = graphemes(rawText).slice(0, STATUS_TEXT_MAX).join('').trim();
  if (!emoji && !text) return undefined;
  return { emoji, text };
}

export function sameStatus(a: PeerStatus | undefined, b: PeerStatus | undefined): boolean {
  return a?.emoji === b?.emoji && a?.text === b?.text;
}

/** How it reads, on the badge and in the people list: "☕ BRB". */
export function statusLabel(s: PeerStatus): string {
  return [s.emoji, s.text].filter(Boolean).join(' ');
}
