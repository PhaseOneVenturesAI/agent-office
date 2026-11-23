import './costwall.css';
import type { CostwallCell, Usage } from '../../shared/protocol';
import { fmtCost, fmtTokens, tokensOf } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal } from './dom';
import { PROVIDER_LABEL } from './provider';

/** "1.2M tokens · $4.31", with the cost left out when the provider can't price its tokens. */
function numbers(usage: Usage, costKnown: boolean): string {
  const tokens = `${fmtTokens(tokensOf(usage))} tokens`;
  return costKnown ? `${tokens} · ${fmtCost(usage.cost)}` : tokens;
}

function cellRow(label: string, cell: CostwallCell) {
  return h(
    'div.cw-row',
    {},
    h('span.cw-who', {}, `${label} · ${cell.workers} worker${cell.workers === 1 ? '' : 's'}`),
    h('span.grow'),
    h('span.cw-num', {}, numbers(cell.usage, cell.costKnown)),
    cell.costKnown ? '' : h('span.cw-unknown', {}, 'cost not reported'),
  );
}

/**
 * 💸 Cost wall: who is spending what, per person and per provider, from the workers at their
 * desks right now — next to the office ledger's tracked spend, workers sent home included
 * (see server/costwall.ts). Follows the numbers as they move.
 */
export function openCostwall(net: Net) {
  const list = h('div.cw-list');
  const ledgerLine = h('div.cw-ledger');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.costwall',
    { role: 'dialog', 'aria-label': 'Cost wall' },
    h('header', {}, h('h2', {}, '💸 Cost wall'), close),
    h('span.cw-status', {}, 'The workers at their desks right now, per person and provider. Refreshes by itself.'),
    list,
    ledgerLine,
  );

  const repaint = () => {
    if (!el.isConnected) return;
    const s = store.costwall;
    list.replaceChildren();
    if (!s.rows.length) list.append(h('p.empty', {}, 'No agents at their desks yet.'));
    for (const row of s.rows) {
      const card = h('article.cw-person', {}, h('h3', {}, row.name));
      for (const [provider, cell] of Object.entries(row.providers)) {
        card.append(cellRow(PROVIDER_LABEL[provider as keyof typeof PROVIDER_LABEL] ?? provider, cell));
      }
      card.append(
        h(
          'div.cw-row.cw-total',
          {},
          h('span.cw-who', {}, 'Total'),
          h('span.grow'),
          h('span.cw-num', {}, numbers(row.total, row.costKnown)),
          row.costKnown ? '' : h('span.cw-unknown', {}, 'some costs not reported'),
        ),
      );
      list.append(card);
    }
    const { ledger } = s;
    ledgerLine.replaceChildren(
      h('span', {}, `Office ledger — today ${fmtCost(ledger.today.cost)} · all time ${fmtCost(ledger.total.cost)}${ledger.budget !== undefined ? ` · daily budget ${fmtCost(ledger.budget)}` : ''}`),
      h('span', {}, 'The ledger tracks Claude Code spend, workers sent home included; the wall above is the live picture across every provider.'),
    );
  };

  const off = store.on('costwall', repaint);
  const modal = openModal(el, {
    doing: '💸 reading the cost wall',
    onClose: () => off(),
  });
  close.addEventListener('click', () => modal.close());
  net.send({ t: 'costwall.get' });
  repaint();
}
