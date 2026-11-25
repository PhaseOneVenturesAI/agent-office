import type { CubbyDeviceAction, CubbyInfo } from '../../../shared/protocol/cubbies';
import { h } from '../../ui/dom';
import { codeOfKey, deviceLabel, signOwnerDevice, type OwnerDeviceKey } from './keys';
import { clip } from './text';

// The devices part of a cubby's chat window (owner only): which of your devices can talk to your lead,
// asking for this one to be added, and approving or removing others. The computer decides who's trusted
// (server/cubbies/local/devices.ts); the office only carries the request and the trusted device's signed
// answer. A new device is approved by comparing the code it shows with the code shown here.

export interface DeviceSends {
  /** This device asks the computer to trust its key. */
  addDevice(id: string, publicKey: string, label: string): void;
  /** A trusted device's signed approve, deny or remove. */
  device(id: string, action: CubbyDeviceAction): void;
}

/** Whether this device's key is one the cubby's computer trusts. */
export const deviceTrusted = (c: CubbyInfo | undefined, key: OwnerDeviceKey | undefined): boolean =>
  !!key && !!c?.interior?.ownerDevices?.some((d) => d.fingerprint === key.fingerprint);

const day = (at: number) => (at ? new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'at setup');

export function deviceSection(sends: DeviceSends | undefined, cubbyId: string, floorOf: () => string | undefined) {
  const el = h('div.cb-devices');
  let asked = 0;
  let busy = false;
  let problem = '';
  /** Codes worked out here from each asking device's key. */
  const codes = new Map<string, string>();

  const act = async (c: CubbyInfo, key: OwnerDeviceKey, action: CubbyDeviceAction['action'], target: string, redraw: () => void) => {
    const floorId = floorOf(), computerId = c.interior?.computerId;
    if (!sends || !floorId || !computerId || busy) return;
    busy = true; redraw();
    try {
      const signed = { action, target, requestId: crypto.randomUUID(), at: Date.now() };
      const ownerSig = await signOwnerDevice(key, { ...signed, cubbyId, floorId, computerId });
      sends.device(cubbyId, { ...signed, ownerSig });
    } catch { problem = 'Could not sign that on this device. Check its browser storage and try again.'; }
    finally { busy = false; redraw(); }
  };

  /** Draws the section for cubby `c` as this device (`key`) sees it. */
  function paint(c: CubbyInfo | undefined, key: OwnerDeviceKey | undefined, redraw: () => void) {
    const it = c?.mine ? c.interior : undefined;
    if (!it || !key || !it.ownerDevices) { el.replaceChildren(); return; }
    const lead = clip(it.leadName, 24) || 'your lead';
    const computer = clip(it.computerName, 32) || 'your computer';
    const asleep = c!.lamp === 'asleep';
    const parts: (HTMLElement | null)[] = [];
    if (!deviceTrusted(c, key)) {
      const waiting = it.deviceRequests?.some((r) => r.publicKey === key.publicKey) || Date.now() - asked < 60_000;
      parts.push(h('p.cb-note.cb-device-ask', {}, waiting
        ? `Waiting for approval. This device's code is ${key.code}. On a device that already talks to ${lead}, check the code matches and press Approve, or on ${computer} run: agent-office cubby devices approve ${key.code.replace(' ', '')} --project <project folder>`
        : `This device can't talk to ${lead} yet. Ask ${computer} to trust it; a device you already use (or ${computer} itself) approves it.`));
      if (!waiting) parts.push(h('button.btn.primary.cb-device-add', { type: 'button', disabled: asleep || !sends,
        onclick: () => { asked = Date.now(); sends?.addDevice(cubbyId, key.publicKey, deviceLabel()); redraw(); } }, '📱 Add this device'));
    } else {
      for (const r of it.deviceRequests ?? []) {
        const code = codes.get(r.publicKey);
        if (!code) { void codeOfKey(r.publicKey).then((c) => { codes.set(r.publicKey, c); redraw(); }, () => {}); continue; }
        parts.push(h('div.cb-device-request', { role: 'group', 'aria-label': `${clip(r.label, 40)} asks to be added` },
          h('p', {}, `📱 ${clip(r.label, 40)} asks to talk to ${lead}. Its code: `, h('b', {}, code)),
          h('small', {}, 'Approve only if that device shows exactly this code.'),
          h('div.cb-device-buttons', {},
            h('button.btn.small.primary', { type: 'button', disabled: busy || asleep, onclick: () => void act(c!, key, 'add', r.publicKey, redraw) }, 'Approve'),
            h('button.btn.small', { type: 'button', disabled: busy || asleep, onclick: () => void act(c!, key, 'deny', r.publicKey, redraw) }, 'Deny'))));
      }
      const devices = it.ownerDevices;
      parts.push(h('details.cb-device-list', {},
        h('summary', {}, `Devices that can talk to ${lead} · ${devices.length}`),
        h('ul', {}, ...devices.map((d) => h('li', {},
          h('span', {}, `${clip(d.label, 40)}${d.fingerprint === key.fingerprint ? ' (this device)' : ''}`),
          h('small', {}, `added ${day(d.addedAt)}`),
          devices.length > 1 ? h('button.btn.small.cb-device-remove', { type: 'button', disabled: busy || asleep, title: `Remove ${clip(d.label, 40)}`,
            onclick: () => void act(c!, key, 'revoke', d.fingerprint, redraw) }, 'Remove') : null)))));
    }
    if (problem) parts.push(h('p.cb-note', { role: 'alert' }, problem));
    el.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
  }

  return { el, paint };
}
