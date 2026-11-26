import { defaultOwnerColor, OWNER_PALETTE, type OwnerColor } from '../../../shared/personal-agents/appearance';
import { PersonalPerson } from './personal-agents/person';
import './ui.css';
import '../../shared/cubby/chat.css';
import '../../ui/character.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import type { Look } from '../../../shared/avatar';
import { HAIR_COLOR_NAMES, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, randomLook } from '../../../shared/avatar';
import { h, openModal, type Modal } from '../../ui/dom';
import { store } from '../../state';
import { ownerDeviceKey, displayFingerprint, type OwnerDeviceKey } from '../../shared/cubby/keys';
import { PROJECT_PLACEHOLDER, cleanLeadName, joinCommand } from './model';

// Setting up a free cubby: your lead's name and look (the office's character picker, for the lead
// rather than you: your own look stays as it is), then the join command your computer runs to bring
// it to life. The office mints the token; the project folder is yours to type here, and only goes
// into the command on this page, never to the office.

const LEAD_NAMES = ['Nova', 'Atlas', 'Juniper', 'Orbit', 'Pixel', 'Sage', 'Echo', 'Maple'];

/** The lead on a turntable, drawn with its own small renderer while the window's open. */
class LeadPreview {
  readonly person: PersonalPerson;
  private renderer: THREE.WebGLRenderer;
  private effect: OutlineEffect;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  private raf = 0;
  private resize: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    name: string,
    look: Look,
    color: OwnerColor,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.0045, defaultColor: [0.17, 0.18, 0.26] });
    this.scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.6));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.6));
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-3, 6, 5);
    this.scene.add(sun);
    this.person = new PersonalPerson(name, color, look);
    this.person.setUniform(store.me.account?.name ?? 'Owner', store.project?.name ?? 'Project', 'CEO', color);
    this.person.root.children.filter(o => o instanceof THREE.Sprite).forEach(o => o.visible = false);
    this.scene.add(this.person.root);
    this.camera.position.set(0, 1.35, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.person.root.rotation.y = Math.sin(now / 1600) * 0.9;
      this.person.update(dt, now / 1000, false, false);
      this.effect.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!w || !hgt) return;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  private gone = false;

  dispose() {
    if (this.gone) return;
    this.gone = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

/** Whether this office is behind Cloudflare Access, so join needs its flag (asked once, see /api/login). */
let behindAccess: Promise<boolean> | null = null;
function cloudflareAccess(): Promise<boolean> {
  behindAccess ??= fetch('/api/login', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((x: { cloudflare?: boolean }) => x.cloudflare === true)
    .catch(() => false);
  return behindAccess;
}

/**
 * The join command, with a box for the project folder on that computer: what you type there goes
 * into the command on this page and nowhere else. The token is shown only here, only to you.
 */
export function joinBox(token: { token: string; floorId: string }): HTMLElement {
  const project = h('input', { type: 'text', placeholder: PROJECT_PLACEHOLDER, 'aria-label': 'Project folder on your computer', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const code = h('code.cb-cmd');
  const copy = h('button.btn.small', { type: 'button' }, 'Copy');
  let cloudflare = false;
  let key: OwnerDeviceKey | undefined;
  copy.disabled = true;
  const fingerprint = h('p.cb-note', {}, 'Preparing this device’s owner key…');
  const paint = () => {
    code.textContent = key ? `${joinCommand({ origin: location.origin, token: token.token, floorId: token.floorId, project: project.value, cloudflare })} --owner-key ${key.publicKey}` : '';
  };
  void ownerDeviceKey(store.me.account?.name).then((value) => {
    key = value; copy.disabled = false;
    fingerprint.textContent = `Owner key fingerprint: ${displayFingerprint(key.fingerprint)}. Compare this with the fingerprint in your computer’s local owner key record. This browser signs chat; add your other devices later from the lead chat (Add this device).`;
    paint();
  }).catch((error: Error) => { fingerprint.textContent = error.message; });
  void cloudflareAccess().then((on) => {
    cloudflare = on;
    paint();
  });
  project.addEventListener('input', paint);
  project.addEventListener('keydown', (e) => e.stopPropagation());
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(code.textContent ?? '');
    copy.textContent = '✓ Copied';
    setTimeout(() => (copy.textContent = 'Copy'), 1500);
  });
  paint();
  return h(
    'div.cb-join',
    {},
    h('p', {}, '🎟 Your cubby is ready. Run this on your computer, and leave it running:'),
    h('label', {}, 'Project folder on your computer', project),
    h('div.cb-command', {}, code, copy),
    fingerprint,
    h('p.cb-note', {}, 'The token is shown only now. The folder stays on this page: the office never learns it. Stop join (or turn cubbies off) and your cubby goes grey.'),
  );
}

export interface SetupDialog {
  /** The office's answer: the token for the cubby you just set up. */
  showToken(t: { token: string; floorId: string }): void;
  readonly open: boolean;
}

/** Sets up the free cubby in `slot`: the lead's name and look, then (once the office answers) the join command. */
export function openSetup(slot: number, send: (leadName: string, look: Look, ownerColor: OwnerColor) => void): SetupDialog {
  const account = store.me.account?.name;
  const deviceKey = ownerDeviceKey(account);
  // Surface failures when submitting, without an unhandled rejection while the picker is open.
  void deviceKey.catch(() => {});
  const look: Look = randomLook();
  let ownerColor = store.cubbies.ownerColor ?? defaultOwnerColor('');
  const placeholder = LEAD_NAMES[Math.floor(Math.random() * LEAD_NAMES.length)];
  const canvas = h('canvas', { 'aria-label': 'Your lead' }) as HTMLCanvasElement;
  const preview = new LeadPreview(canvas, placeholder, look, ownerColor);
  const name = h('input', { type: 'text', maxlength: 24, placeholder, 'aria-label': 'Lead name' }) as HTMLInputElement;
  name.addEventListener('keydown', (e) => e.stopPropagation());
  const ownerRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Owner colour' });
  const skinRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Skin tone' });
  const styleRow = h('div.seg', { role: 'radiogroup', 'aria-label': 'Hair style' });
  const hairRow = h('div.swatches', { role: 'radiogroup', 'aria-label': 'Hair color' });
  const swatch = (color: string, label: string, on: boolean, choose: () => void) =>
    h('button.swatch', { type: 'button', role: 'radio', 'aria-checked': String(on), style: `background:${color}`, class: on ? 'sel' : '', 'aria-label': label, title: label, onclick: choose });
  const change = (l: Partial<Look>) => {
    Object.assign(look, l);
    preview.person.setLook(look);
    paint();
  };
  const paint = () => {
    ownerRow.replaceChildren(...OWNER_PALETTE.map(p => swatch(p.color, `Owner colour: ${p.name}`, p.color === ownerColor, () => {
      ownerColor = p.color;
      preview.person.setUniform(account ?? 'Owner', store.project?.name ?? 'Project', 'CEO', ownerColor);
      preview.person.root.children.filter(o => o instanceof THREE.Sprite).forEach(o => o.visible = false);
      paint();
    })));
    skinRow.replaceChildren(...SKIN_TONES.map((c, i) => swatch(c, `Skin tone ${i + 1} of ${SKIN_TONES.length}`, i === look.skin, () => change({ skin: i }))));
    styleRow.replaceChildren(...HAIR_STYLES.map((s, i) => h('button.btn', { type: 'button', role: 'radio', 'aria-checked': String(i === look.style), class: i === look.style ? 'on' : '', onclick: () => change({ style: i }) }, s)));
    hairRow.replaceChildren(...HAIR_COLORS.map((c, i) => swatch(c, HAIR_COLOR_NAMES[i], i === look.hair, () => change({ hair: i }))));
  };
  paint();

  const submit = h('button.btn.primary', { type: 'submit' }, 'Set up');
  const status = h('span.grow', {}, `Cubby ${slot + 1}`);
  const body = h(
    'div.body',
    {},
    h('div.charsel-stage', {}, canvas),
    h('div.charsel-opts', {}, h('label', {}, 'Lead name'), name, h('label', {}, 'Owner colour'), ownerRow, h('label', {}, 'Skin tone'), skinRow, h('label', {}, 'Hair'), styleRow, h('label', {}, 'Hair color'), hairRow),
  );
  const form = h('form.modal.charsel.cubby-setup', { role: 'dialog', 'aria-label': 'Set up your cubby' }, h('header', {}, h('h2', {}, '✨ Set up your cubby')), body, h('footer', {}, status, submit)) as HTMLFormElement;

  let modal: Modal | null = null;
  let sent = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sent) return;
    sent = true;
    submit.disabled = true;
    try {
      await deviceKey;
      if (store.me.account?.name !== account) throw new Error('Account changed. Reopen cubby setup.');
      if (!form.isConnected) return;
    } catch (error) {
      status.textContent = (error as Error).message; sent = false; submit.disabled = false; return;
    }
    const leadName = cleanLeadName(name.value) || placeholder;
    send(leadName, { ...look }, ownerColor);
    submit.disabled = true;
    status.textContent = `Setting up ${leadName}…`;
  });
  modal = openModal(form, { doing: '✨ setting up a cubby', onClose: () => preview.dispose() });
  setTimeout(() => name.focus(), 30);
  return {
    get open() {
      return !!modal && form.isConnected;
    },
    showToken(t) {
      preview.dispose();
      form.querySelector('footer')?.remove();
      form.classList.remove('charsel');
      body.className = 'body';
      body.replaceChildren(joinBox(t));
    },
  };
}

/** The join command on its own, when the token comes after the setup window was closed. */
export function openJoin(t: { token: string; floorId: string }) {
  const el = h('div.modal.cubby-setup', { role: 'dialog', 'aria-label': 'Join your computer' }, h('header', {}, h('h2', {}, '🎟 Join your computer')), h('div.body', {}, joinBox(t)));
  openModal(el, { doing: '✨ setting up a cubby' });
}
