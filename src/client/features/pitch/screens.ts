import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Ctx } from '../../core/context';
import { TvPlayer, PLAYER_W } from '../tv/player';
import type { Station } from './world';
import { liveSiteUrl, SiteFrame } from './site-frame';
/** Reuses the TV's player and CSS3D hole technique; destroyed immediately on exit. */
export class PitchScreens {
  private css = new CSS3DRenderer();
  private scene = new THREE.Scene();
  private obj?: CSS3DObject;
  private player?: TvPlayer;
  private site?: SiteFrame;
  private station?: Station;
  private hole = new THREE.MeshBasicMaterial({ opacity: 0, blending: THREE.NoBlending });
  private start = 0;
  constructor(private ctx: Ctx, layer = 'pitch-video-layer') {
    this.hole.userData.outlineParameters = { visible: false };
    this.css.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.css.domElement.className = layer;
    ctx.canvas.before(this.css.domElement);
    const fit = () => this.css.setSize(innerWidth, innerHeight); window.addEventListener('resize', fit); fit();
  }
  stop() {
    if (this.station) { this.station.face.material = this.station.material; const p = this.station.group.getObjectByName('pitch-placeholder'); if (p) p.visible = true; }
    this.player?.destroy(); this.player = undefined;
    this.site?.destroy(); this.site = undefined;
    if (this.obj) { this.scene.remove(this.obj); this.obj.element.remove(); }
    this.obj = undefined; this.station = undefined;
  }
  tick(station?: Station) {
    const site = station?.piece.kind === 'site' && !matchMedia('(prefers-reduced-motion: reduce)').matches && !matchMedia('(pointer: coarse)').matches ? liveSiteUrl(station.piece.url) : undefined;
    if (station && site) { this.tickSite(station, site); return; }
    if (!station?.piece.youtube) { this.stop(); return; }
    if (station !== this.station) {
      this.stop(); this.station = station; this.start = performance.now();
      this.player = new TvPlayer(station.piece.youtube, () => (performance.now() - this.start) / 1000, () => {});
      this.obj = new CSS3DObject(this.player.el); this.scene.add(this.obj);
    }
    this.player!.sync();
    this.player!.setVolume(this.ctx.settings.musicMuted ? 0 : this.ctx.settings.music * 0.5);
    this.place(station, this.player!.playing);
  }
  private tickSite(station: Station, url: string) {
    if (station !== this.station) {
      this.stop(); this.station = station;
      this.site = new SiteFrame(url);
      this.obj = new CSS3DObject(this.site.el); this.scene.add(this.obj);
    }
    this.place(station, this.site!.playing);
  }
  private place(station: Station, playing: boolean) {
    station.face.updateWorldMatrix(true, false);
    station.face.getWorldPosition(this.obj!.position); station.face.getWorldQuaternion(this.obj!.quaternion);
    this.obj!.scale.setScalar(station.width / PLAYER_W);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.obj!.quaternion);
    const front = facing.dot(this.ctx.camera.position.clone().sub(this.obj!.position)) > 0;
    station.face.material = playing && front ? this.hole : station.material;
    const placeholder = station.group.getObjectByName('pitch-placeholder'); if (placeholder) placeholder.visible = !(playing && front);
    this.css.render(this.scene, this.ctx.camera);
  }
}
