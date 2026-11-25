// The URLs in a chat message, so the chat can show them as real links while everything around
// them stays plain text (the DOM escapes text nodes, so nothing in a message can turn into markup).

/** A message cut into its pieces, in order: a run of plain text, or a URL to link. */
export type ChatPart = string | { href: string };

/** What can make up a URL in a message: anything but whitespace and the brackets that quote it. */
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that ends the sentence around a link, not the link ("see https://x.dev/a." links to /a). */
const TRAILING = /[.,;:!?)\]}'"]+$/;

export function linkify(text: string): ChatPart[] {
  const parts: ChatPart[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const href = m[0].replace(TRAILING, '');
    // Something the browser wouldn't open (a bare "http://.", say) stays plain text.
    try {
      if (!new URL(href).hostname) continue;
    } catch {
      continue;
    }
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push({ href });
    at = m.index + href.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}
