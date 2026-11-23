/** Only for already-structured assistant prose. Never sanitize terminal output into trusted speech. */
export function safeAssistantText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || value.length > 24000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value)) return;
  // Suppress the entire reply rather than partially reading recognizable credentials aloud.
  if (/-----BEGIN [\w ]*PRIVATE KEY-----|\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{12,}|\bBearer\s+\S+|\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret)\s*[:=]\s*\S+|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i.test(value)) return;
  return value.trim();
}

/** Speech omits code blocks, inline code and URLs; the visible transcript retains normal prose. */
export function spokenAssistantText(value: string): string | undefined {
  const safe = safeAssistantText(value);
  if (!safe) return;
  return safe.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '').replace(/[\*_#>]/g, '').trim() || undefined;
}
