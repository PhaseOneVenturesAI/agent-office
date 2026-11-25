/**
 * The office TV: a YouTube video someone put on, the screen someone on the floor is sharing (which
 * goes over the video while it's up), or its idle card. What's shared, and watching it full screen,
 * is features/voice's; the video and how it's drawn are screen.ts's.
 */
import { clip } from '../../ui/dom';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { TvScreen } from './screen';
import { openTv } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    tv: true;
  }
}

export interface TvDeps {
  /** The screens shared on this floor, by who's sharing them (see features/voice). */
  shares(): [string, MediaStream][];
  /** Watches what's shared on the TV full screen (see features/voice). */
  watch(): void;
  /** Shares your screen, or stops sharing it (see features/voice). */
  toggleShare(): void;
}

export function installTv(ctx: Ctx, deps: TvDeps) {
  const screen = new TvScreen(ctx);
  ctx.ticks.add('render', () => screen.tick());
  store.on('tv', () => ctx.hint.invalidate());

  /** Who's sharing the screen on the TV: someone else's before your own. */
  const sharer = () => {
    const shares = deps.shares();
    return (shares.find(([who]) => who !== 'You') ?? shares[0])?.[0] ?? null;
  };

  ctx.interactions.define('tv', {
    reach: 10,
    hint: () => {
      const status = screen.status();
      const what = status === 'share' ? `🖥️ ${sharer() ?? 'a screen'}` : status === 'video' ? `▶️ YouTube, put on by ${clip(store.tv?.by ?? 'someone', 24)}` : 'off';
      return { k: `${status}|${what}`, parts: [hintTitle('📺 Office TV'), aside(what), key('E', 'Put something on')] };
    },
    use: onE(() =>
      openTv(ctx.net, {
        sharer,
        sharing: () => ctx.voice.sharing,
        watch: () => deps.watch(),
        toggleShare: () => deps.toggleShare(),
      }),
    ),
  });

  return {
    /** Puts `stream` up on the TV, or takes it down (null). */
    show: (stream: MediaStream | null) => screen.showShare(stream),
  };
}
