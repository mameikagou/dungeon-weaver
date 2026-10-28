import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import type { EntityPool } from '../engine/pool';
import type { Simulation } from '../engine/simulation';
import { ROOM_HEIGHT, ROOM_WIDTH } from '../content/rooms';

function spriteAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d')!;
  for (let frame = 0; frame < 4; frame++) {
    const left = frame * 64;
    const bob = [0, -2, 0, 2][frame];
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(left + 12, 54);
    context.quadraticCurveTo(left + 6, 14 + bob, left + 31, 9 + bob);
    context.quadraticCurveTo(left + 58, 14 + bob, left + 52, 54);
    context.lineTo(left + 41, 49 + bob);
    context.lineTo(left + 31, 55);
    context.lineTo(left + 22, 49 + bob);
    context.fill();
    context.fillStyle = '#192934';
    context.fillRect(left + 21, 28 + bob, 7, 9);
    context.fillRect(left + 37, 28 + bob, 7, 9);
    context.fillStyle = '#ffffff';
    context.fillRect(left + 23, 29 + bob, 3, 3);
    context.fillRect(left + 39, 29 + bob, 3, 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeActors(capacity: number, texture: THREE.Texture) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  const lean = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('aFlash', flash);
  geometry.setAttribute('aLean', lean);
  const material = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: texture }, uTick: { value: 0 } },
    vertexShader: `
      attribute float aFlash;
      attribute float aLean;
      uniform float uTick;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFlash;
      void main() {
        float frame = mod(floor(uTick / 9.0), 4.0);
        vUv = vec2((uv.x + frame) / 4.0, uv.y);
        vTint = instanceColor;
        vFlash = aFlash;
        vec3 point = position;
        point.x += aLean * (point.y + 0.5) * 0.13;
        point.y *= 1.0 + sin(uTick * 0.3) * abs(aLean) * 0.04;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(point, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFlash;
      void main() {
        vec4 sampleColor = texture2D(uAtlas, vUv);
        if (sampleColor.a < 0.15) discard;
        vec3 color = mix(sampleColor.rgb * vTint, vec3(1.0), clamp(vFlash, 0.0, 1.0));
        if (any(isnan(color)) || any(isinf(color))) color = vec3(1.0, 0.0, 1.0);
        gl_FragColor = vec4(clamp(color, 0.0, 4.0), 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.frustumCulled = false;
  return { mesh, flash, lean };
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-14, 14, 10, -10, 0.1, 100);
  private readonly composer: EffectComposer;
  private readonly texture = spriteAtlas();
  private readonly actors = makeActors(2001, this.texture);
  private readonly bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: '#bfffe5' }), 5000);
  private readonly shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.37, 12), new THREE.MeshBasicMaterial({ color: '#081719', transparent: true, opacity: 0.55, depthWrite: false }), 2001);
  private readonly terrain = new THREE.Group();
  private readonly dummy = new THREE.Object3D();
  private readonly tint = new THREE.Color();
  private readonly ray = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly target = new THREE.Vector3();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private roomId = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene.background = new THREE.Color('#101d23');
    this.scene.fog = new THREE.Fog('#101d23', 30, 65);
    this.camera.position.set(10, 24, 31.5);
    this.camera.lookAt(10, 0, 7.5);
    this.scene.add(new THREE.HemisphereLight('#d7ffe9', '#243446', 2.5));
    const light = new THREE.DirectionalLight('#ffdeb0', 3);
    light.position.set(-5, 18, 8);
    this.scene.add(light, this.terrain, this.actors.mesh, this.bullets, this.shadows);
    this.bullets.frustumCulled = this.shadows.frustumCulled = false;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera, new BloomEffect({ intensity: 0.25, luminanceThreshold: 0.85, mipmapBlur: true })));
    this.resize();
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const aspect = width / height;
    const span = Math.max(10.5, 12 / aspect);
    this.camera.left = -span * aspect;
    this.camera.right = span * aspect;
    this.camera.top = span;
    this.camera.bottom = -span;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  private buildRoom(simulation: Simulation): void {
    this.disposeTerrain();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.95 });
    const blocks = new THREE.InstancedMesh(geometry, material, ROOM_WIDTH * ROOM_HEIGHT * 2);
    let count = 0;
    simulation.room.rows.forEach((row, z) => [...row].forEach((cell, x) => {
      const variation = ((x * 7 + z * 3) % 5) * 0.025;
      this.dummy.position.set(x + 0.5, -0.3, z + 0.5);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(0.98, 0.5, 0.98);
      this.dummy.updateMatrix();
      blocks.setMatrixAt(count, this.dummy.matrix);
      blocks.setColorAt(count++, this.tint.setRGB(0.11 + variation, 0.21 + variation, 0.21 + variation));
      if (cell !== '#') return;
      const edge = x === 0 || x === ROOM_WIDTH - 1 || z === 0 || z === ROOM_HEIGHT - 1;
      const height = edge ? 0.55 : 1.3;
      this.dummy.position.y = height / 2;
      this.dummy.scale.set(0.96, height, 0.96);
      this.dummy.updateMatrix();
      blocks.setMatrixAt(count, this.dummy.matrix);
      blocks.setColorAt(count++, this.tint.set(edge ? '#355354' : '#50786a'));
    }));
    blocks.count = count;
    blocks.instanceMatrix.needsUpdate = true;
    this.terrain.add(blocks);
    const base = new THREE.Mesh(new THREE.BoxGeometry(20.3, 0.7, 15.3), new THREE.MeshStandardMaterial({ color: '#172c30' }));
    base.position.set(10, -0.7, 7.5);
    this.terrain.add(base);
    this.roomId = simulation.room.id;
  }

  draw(simulation: Simulation): void {
    if (this.roomId !== simulation.room.id) this.buildRoom(simulation);
    this.actors.mesh.material.uniforms.uTick.value = simulation.combatTick;
    this.drawActor(simulation.player, 0, 0, '#b9fae3');
    for (let index = 0; index < simulation.enemies.count; index++) {
      this.drawActor(simulation.enemies, simulation.enemies.active[index], index + 1, '#f5a774');
    }
    const count = simulation.enemies.count + 1;
    this.actors.mesh.count = this.shadows.count = count;
    this.actors.flash.needsUpdate = this.actors.lean.needsUpdate = true;
    this.actors.mesh.instanceMatrix.needsUpdate = true;
    this.actors.mesh.instanceColor!.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(1, 1, 1);
    for (let index = 0; index < simulation.bullets.count; index++) {
      const slot = simulation.bullets.active[index];
      this.dummy.position.set(simulation.bullets.x[slot], 0.45, simulation.bullets.z[slot]);
      this.dummy.updateMatrix();
      this.bullets.setMatrixAt(index, this.dummy.matrix);
    }
    this.bullets.count = simulation.bullets.count;
    this.bullets.instanceMatrix.needsUpdate = true;
    this.composer.render(0);
  }

  private drawActor(pool: EntityPool, slot: number, index: number, color: string): void {
    this.dummy.position.set(pool.x[slot], 0.62, pool.z[slot]);
    this.dummy.quaternion.copy(this.camera.quaternion);
    this.dummy.scale.set(1.05, 1.25, 1);
    this.dummy.updateMatrix();
    this.actors.mesh.setMatrixAt(index, this.dummy.matrix);
    this.actors.mesh.setColorAt(index, this.tint.set(color));
    this.actors.flash.setX(index, pool.flash[slot] > 0 ? 0.85 : 0);
    this.actors.lean.setX(index, Math.max(-1, Math.min(1, pool.vx[slot] / 4)));
    this.dummy.position.y = 0.015;
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.dummy.scale.set(1, 1, 1);
    this.dummy.updateMatrix();
    this.shadows.setMatrixAt(index, this.dummy.matrix);
  }

  aim(clientX: number, clientY: number): THREE.Vector3 {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2);
    this.ray.setFromCamera(this.pointer, this.camera);
    this.ray.ray.intersectPlane(this.ground, this.target);
    return this.target;
  }

  private disposeTerrain(): void {
    this.terrain.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.terrain.clear();
  }

  dispose(): void {
    this.disposeTerrain();
    for (const mesh of [this.actors.mesh, this.bullets, this.shadows]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    this.texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
