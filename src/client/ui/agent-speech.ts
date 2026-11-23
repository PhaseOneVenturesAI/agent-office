import { spokenAssistantText } from '../../shared/assistant-text';

/** Browser-owned speech only; no external voice service, terminal stream, or automatic microphone. */
export function agentSpeaker() {
  const engine = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
  let enabled = false;
  return {
    available: !!engine && typeof SpeechSynthesisUtterance !== 'undefined',
    enable(value: boolean) { enabled = value; if (!value) engine?.cancel(); },
    stop() { engine?.cancel(); },
    say(value: string) {
      const text = spokenAssistantText(value);
      if (!enabled || !engine || !text) return;
      engine.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const local = engine.getVoices().find((v) => v.localService && v.lang.startsWith(navigator.language.split('-')[0]));
      if (local) utterance.voice = local;
      engine.speak(utterance);
    },
  };
}
