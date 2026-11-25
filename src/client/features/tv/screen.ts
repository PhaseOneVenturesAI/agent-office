// What's on the office TV's screen: someone's shared screen, a YouTube video, or a card saying what's
// up. A YouTube player can't be drawn into WebGL (it's another site's page), so it sits under the
// canvas in a CSS 3D layer lined up with the TV, and the screen is drawn see-through, a hole in the
// canvas: people walking in front of the TV still hide it.
import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { TV } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { tvCard } from './cards';
import { PLAYER_W, TvPlayer } from './player';

/** How the video fades with distance from the TV, like the jukebox. */
const REF = 3;
const ROLLOFF = 1;
/** Further than this, the video isn't drawn (it's a speck), though it's still heard. */
const FAR = 45;

export class TvScreen {
  private readonly mat: THREE.MeshBasicMaterial;
  /** Clears the canvas to see-through wherever the screen shows, so the player under it shows. */
  private readonly hole = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending });
  private readonly idle = tvCard('📺 Office TV', 'Press E to put on a YouTube video or share your screen');
  private readonly loading = tvCard('▶️ YouTube', 'Tuning in…', '#c1121f', '#ff6b6b');
  private readonly ended = tvCard('🎬 That’s the end', 'Press E to put on another video', '#3a0ca3', '#4cc9f0');
  private error: { text: string; tex: THREE.CanvasTexture } | null = null;
  private readonly shareVideo = document.createElement('video');
  private readonly shareTex: THREE.VideoTexture;
  private share: MediaStream | null = null;

  private readonly css = new CSS3DRenderer();
  private readonly cssScene = new THREE.Scene();
  private obj: CSS3DObject | null = null;
  private player: TvPlayer | null = null;
  private playing: { id: string; startedAt: number } | null = null;
  private readonly at = new THREE.Vector3();
  private readonly facing = new THREE.Vector3();
  private readonly toTv = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();

  constructor(private readonly ctx: Ctx) {
    this.hole.userData.outlineParameters = { visible: false };
    this.mat = ctx.office.tvScreen.material as THREE.MeshBasicMaterial;
    this.mat.color.set('#ffffff');
    this.mat.map = this.idle;
    this.mat.toneMapped = false;
    this.shareVideo.muted = true;
    this.shareVideo.playsInline = true;
    this.shareVideo.autoplay = true;
    this.shareTex = new THREE.VideoTexture(this.shareVideo);
    this.shareTex.colorSpace = THREE.SRGBColorSpace;

    // Under the canvas, the same size, and never in the way of the mouse.
    const layer = this.css.domElement;
    layer.className = 'tv-layer';
    layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    ctx.renderer.domElement.before(layer);
    const fit = () => this.css.setSize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', fit);
    fit();
  }

  /** Puts a shared screen up, over any video, or takes it down (null). */
  showShare(stream: MediaStream | null) {
    if (stream === this.share) return;
    this.share = stream;
    this.shareVideo.srcObject = stream;
    if (stream) void this.shareVideo.play().catch(() => {});
  }

  /** What's on, for the hint and the TV's window. */
  status(): 'share' | 'video' | 'idle' {
    return this.share ? 'share' : store.tv && this.ctx.inOffice() ? 'video' : 'idle';
  }

  /** Each frame: the video started or stopped as the office says, lined up, heard, and shown or not. */
  tick() {
    const v = this.ctx.inOffice() ? store.tv : null;
    if (!v) this.stopPlayer();
    else if (!this.playing || this.playing.id !== v.id || this.playing.startedAt !== v.startedAt) this.startPlayer(v.id, v.startedAt);
    const p = this.player;
    p?.sync();

    const tv = this.ctx.office.tvScreen;
    tv.updateWorldMatrix(true, false);
    tv.matrixWorld.decompose(this.at, this.quat, this.facing);
    this.facing.set(0, 0, 1).applyQuaternion(this.quat);
    const cam = this.ctx.camera.position;
    const far = cam.distanceTo(this.at);
    const inFront = this.facing.dot(this.toTv.subVectors(this.at, cam)) < 0;
    const live = !!p && p.playing && !this.share;

    let map: THREE.Texture | null = this.idle;
    if (this.share) map = this.shareTex;
    else if (p?.error) map = this.errorCard(p.error);
    else if (p?.ended) map = this.ended;
    else if (p) map = this.loading;
    if (this.mat.map !== map) {
      this.mat.map = map;
      this.mat.needsUpdate = true;
    }
    // Only a picture that's playing, and in sight, gets the hole: otherwise there'd be the page behind it.
    const mat = live && inFront && far < FAR ? this.hole : this.mat;
    if (tv.material !== mat) tv.material = mat;

    if (p && this.obj) {
      const s = this.ctx.settings;
      const gain = s.musicMuted || this.share ? 0 : s.music * s.music;
      const d = Math.max(REF, far);
      p.setVolume(gain * (REF / (REF + ROLLOFF * (d - REF))));
      // It's under the canvas, so it only shows through the hole; it's lined up even while it doesn't, so it's ready.
      if (inFront && far < FAR && worldVisible(tv)) {
        this.obj.position.copy(this.at);
        this.obj.quaternion.copy(this.quat);
        this.obj.scale.setScalar(TV.width / PLAYER_W);
        this.css.render(this.cssScene, this.ctx.camera);
      }
    }
  }

  private startPlayer(id: string, startedAt: number) {
    this.stopPlayer();
    this.playing = { id, startedAt };
    const p = new TvPlayer(
      id,
      () => (store.tv ? Math.max(0, (performance.now() - store.tv.since) / 1000) : 0),
      () => this.ctx.hint.invalidate(),
    );
    this.player = p;
    this.obj = new CSS3DObject(p.el);
    this.cssScene.add(this.obj);
    // Drawn once now, so the player is on the page (YouTube won't load one that isn't).
    this.css.render(this.cssScene, this.ctx.camera);
  }

  private stopPlayer() {
    if (!this.playing) return;
    this.playing = null;
    this.player?.destroy();
    this.player = null;
    if (this.obj) this.cssScene.remove(this.obj);
    this.obj = null;
  }

  private errorCard(text: string): THREE.CanvasTexture {
    if (this.error?.text !== text) {
      this.error?.tex.dispose();
      this.error = { text, tex: tvCard('📺 Can’t play that', text, '#3d405b', '#81b29a') };
    }
    return this.error.tex;
  }
}

/** Whether `o` and everything it's in is shown (the office on another map isn't). */
function worldVisible(o: THREE.Object3D | null): boolean {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}
