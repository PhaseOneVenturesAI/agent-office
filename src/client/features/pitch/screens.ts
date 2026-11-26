import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { Ctx } from '../../core/context';
import { TvPlayer, PLAYER_W } from '../tv/player';
import type { Station } from './world';
/** Reuses the TV's player and CSS3D hole technique; destroyed immediately on exit. */
export class PitchScreens {
  private css = new CSS3DRenderer();
  private scene = new THREE.Scene();
  private obj?: CSS3DObject;
  private player?: TvPlayer;
  private station?: Station;
  private hole = new THREE.MeshBasicMaterial({ opacity: 0, blending: THREE.NoBlending });
  private start = 0;
  constructor(private ctx: Ctx) {
    this.hole.userData.outlineParameters = { visible: false };
    this.css.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    this.css.domElement.className = 'pitch-video-layer';
    ctx.canvas.before(this.css.domElement);
    const fit = () => this.css.setSize(innerWidth, innerHeight); window.addEventListener('resize', fit); fit();
  }
  stop() {
    if (this.station) this.station.face.material = this.station.material;
    this.player?.destroy(); this.player = undefined;
    if (this.obj) { this.scene.remove(this.obj); this.obj.element.remove(); }
    this.obj = undefined; this.station = undefined;
  }
  tick(station?: Station) {
    if (!station?.piece.youtube) { this.stop(); return; }
    if (station !== this.station) {
      this.stop(); this.station = station; this.start = performance.now();
      this.player = new TvPlayer(station.piece.youtube, () => (performance.now() - this.start) / 1000, () => {});
      this.obj = new CSS3DObject(this.player.el); this.scene.add(this.obj);
    }
    this.player!.sync();
    this.player!.setVolume(this.ctx.settings.musicMuted ? 0 : this.ctx.settings.music * 0.5);
    station.face.updateWorldMatrix(true, false);
    station.face.getWorldPosition(this.obj!.position); station.face.getWorldQuaternion(this.obj!.quaternion);
    this.obj!.scale.setScalar(station.width / PLAYER_W);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.obj!.quaternion);
    const front = facing.dot(this.ctx.camera.position.clone().sub(this.obj!.position)) > 0;
    station.face.material = this.player!.playing && front ? this.hole : station.material;
    this.css.render(this.scene, this.ctx.camera);
  }
}
