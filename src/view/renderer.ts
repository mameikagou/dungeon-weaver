import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import type { EntityPool } from '../engine/pool';
import type { Simulation } from '../engine/simulation';
import { ROOM_HEIGHT, ROOM_WIDTH } from '../content/rooms';
import { enemyTypes } from '../content/enemies';

function spriteAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 320;
  const context = canvas.getContext('2d')!;
  for (let kind = 0; kind < 5; kind++) {
    context.save();
    context.translate(0, kind * 64);
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
      if (kind === 0) {
        context.fillStyle = '#315c58';
        context.fillRect(left + 13, 42 + bob, 37, 8);
        context.fillStyle = '#ffffff';
        context.fillRect(left + 49, 31 + bob, 7, 22);
        context.fillRect(left + 46, 28 + bob, 13, 7);
      } else if (kind === 1) {
        context.beginPath();
        context.moveTo(left + 15, 22);
        context.lineTo(left + 5, 5);
        context.lineTo(left + 27, 15);
        context.moveTo(left + 38, 15);
        context.lineTo(left + 59, 5);
        context.lineTo(left + 49, 23);
        context.fill();
      } else if (kind === 2) {
        context.beginPath();
        context.moveTo(left + 3, 23);
        context.lineTo(left + 31, 1);
        context.lineTo(left + 61, 23);
        context.fill();
        context.fillRect(left + 4, 42 + bob, 12, 12);
      } else if (kind === 3) {
        context.fillRect(left + 9, 14, 46, 10);
        context.fillRect(left + 9, 13, 8, 33);
        context.fillStyle = '#344355';
        context.fillRect(left + 21, 29 + bob, 25, 4);
      } else {
        context.beginPath();
        context.moveTo(left + 10, 21);
        context.lineTo(left + 8, 2);
        context.lineTo(left + 22, 12);
        context.lineTo(left + 32, 0);
        context.lineTo(left + 43, 12);
        context.lineTo(left + 57, 2);
        context.lineTo(left + 54, 21);
        context.fill();
      }
    }
    context.restore();
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
  const kind = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  geometry.setAttribute('aFlash', flash);
  geometry.setAttribute('aLean', lean);
  geometry.setAttribute('aKind', kind);
  const material = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: texture }, uTick: { value: 0 } },
    vertexShader: `
      attribute float aFlash;
      attribute float aLean;
      attribute float aKind;
      uniform float uTick;
      varying vec2 vUv;
      varying vec3 vTint;
      varying float vFlash;
      void main() {
        float frame = mod(floor(uTick / 9.0), 4.0);
        vUv = vec2((uv.x + frame) / 4.0, (uv.y + 4.0 - aKind) / 5.0);
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
  return { mesh, flash, lean, kind };
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-14, 14, 10, -10, 0.1, 100);
  private readonly composer: EffectComposer;
  private readonly texture = spriteAtlas();
  private readonly actors = makeActors(2001, this.texture);
  private readonly bullets = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.13, 6, 4),
    new THREE.MeshBasicMaterial({ color: '#bfffe5' }),
    5000,
  );
  private readonly shadows = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.37, 12),
    new THREE.MeshBasicMaterial({ color: '#081719', transparent: true, opacity: 0.55, depthWrite: false }),
    2001,
  );
  private readonly zoneRings = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.91, 1, 40),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    128,
  );
  private readonly zoneFills = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 40),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
    128,
  );
  private readonly warnings = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.025, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
    2000,
  );
  private readonly swings = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 32, -Math.acos(0.2), 2 * Math.acos(0.2)),
    new THREE.MeshBasicMaterial({
      color: '#ff9b6d',
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    2000,
  );
  private readonly fans = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 32, -0.88, 1.76),
    new THREE.MeshBasicMaterial({
      color: '#ffbf6a',
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    2000,
  );
  private readonly sparks = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.7, 1, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }),
    128,
  );
  private readonly weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.17, 0.2),
    new THREE.MeshBasicMaterial({ color: '#e5f8b9' }),
  );
  private readonly chargeRing = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 0.9, 40),
    new THREE.MeshBasicMaterial({ color: '#e9f5a7', transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  private readonly dashBar = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.07),
    new THREE.MeshBasicMaterial({ color: '#a6eddb', side: THREE.DoubleSide }),
  );
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
    this.scene.add(
      light,
      this.terrain,
      this.actors.mesh,
      this.bullets,
      this.shadows,
      this.zoneRings,
      this.zoneFills,
      this.warnings,
      this.swings,
      this.fans,
      this.sparks,
      this.weapon,
      this.chargeRing,
      this.dashBar,
    );
    for (const mesh of [this.zoneRings, this.zoneFills, this.warnings, this.swings, this.fans, this.sparks])
      mesh.frustumCulled = false;
    this.bullets.frustumCulled = this.shadows.frustumCulled = false;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(
      new EffectPass(this.camera, new BloomEffect({ intensity: 0.25, luminanceThreshold: 0.85, mipmapBlur: true })),
    );
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
    simulation.room.rows.forEach((row, z) =>
      [...row].forEach((cell, x) => {
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
      }),
    );
    blocks.count = count;
    blocks.instanceMatrix.needsUpdate = true;
    this.terrain.add(blocks);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(20.3, 0.7, 15.3),
      new THREE.MeshStandardMaterial({ color: '#172c30' }),
    );
    base.position.set(10, -0.7, 7.5);
    this.terrain.add(base);
    this.roomId = simulation.room.id;
  }

  draw(simulation: Simulation): void {
    if (this.roomId !== simulation.room.id) this.buildRoom(simulation);
    this.actors.mesh.material.uniforms.uTick.value = simulation.combatTick;
    this.drawActor(simulation.player, 0, 0, simulation.empoweredTicks ? '#fff5ac' : '#b9fae3', simulation);
    for (let index = 0; index < simulation.enemies.count; index++) {
      const slot = simulation.enemies.active[index];
      this.drawActor(simulation.enemies, slot, index + 1, enemyTypes[simulation.enemies.kind[slot]].color, simulation);
    }
    const count = simulation.enemies.count + 1;
    this.actors.mesh.count = this.shadows.count = count;
    this.actors.flash.needsUpdate = this.actors.lean.needsUpdate = this.actors.kind.needsUpdate = true;
    this.actors.mesh.instanceMatrix.needsUpdate = true;
    this.actors.mesh.instanceColor!.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.scale.set(1, 1, 1);
    for (let index = 0; index < simulation.bullets.count; index++) {
      const slot = simulation.bullets.active[index];
      const size = simulation.bullets.radius[slot] / 0.13;
      this.dummy.scale.set(size, size, size);
      this.dummy.position.set(simulation.bullets.x[slot], 0.45, simulation.bullets.z[slot]);
      this.dummy.updateMatrix();
      this.bullets.setMatrixAt(index, this.dummy.matrix);
      this.bullets.setColorAt(
        index,
        this.tint.set(
          simulation.bullets.kind[slot] === 2 ? '#ff8065' : simulation.bullets.kind[slot] === 1 ? '#fff6b2' : '#bfffe5',
        ),
      );
    }
    this.bullets.count = simulation.bullets.count;
    this.bullets.instanceMatrix.needsUpdate = true;
    if (this.bullets.instanceColor) this.bullets.instanceColor.needsUpdate = true;
    this.drawCombatIndicators(simulation);
    this.drawEffects(simulation);
    this.camera.position.x =
      10 + (simulation.shakeTicks ? Math.sin(simulation.combatTick * 2.3) * 0.055 * simulation.shakeTicks : 0);
    this.composer.render(0);
  }

  private drawActor(pool: EntityPool, slot: number, index: number, color: string, simulation: Simulation): void {
    const player = index === 0;
    const size = !player && pool.kind[slot] === 3 ? 1.8 : 1;
    const moving = Math.hypot(pool.vx[slot], pool.vz[slot]) > 0.1;
    const bob = Math.sin(simulation.combatTick * (moving ? 0.3 : 0.07)) * (moving ? 0.045 : 0.02);
    this.dummy.position.set(pool.x[slot], 0.62 * size + bob, pool.z[slot]);
    this.dummy.quaternion.copy(this.camera.quaternion);
    const squash = player && simulation.chargeTicks > 0 ? 0.86 : 1;
    this.dummy.scale.set((1.05 * size) / squash, 1.25 * size * squash, 1);
    if (player && simulation.phase === 'dead') {
      this.dummy.rotateZ(Math.PI / 2);
      this.dummy.scale.multiplyScalar(0.75);
    }
    this.dummy.updateMatrix();
    this.actors.mesh.setMatrixAt(index, this.dummy.matrix);
    this.actors.mesh.setColorAt(index, this.tint.set(color));
    this.actors.flash.setX(index, pool.flash[slot] > 0 ? 0.85 : 0);
    this.actors.kind.setX(index, player ? 0 : pool.kind[slot] + 1);
    this.actors.lean.setX(index, Math.max(-1, Math.min(1, pool.vx[slot] / 4)));
    this.dummy.position.y = 0.015;
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    this.dummy.scale.set(size, size, 1);
    this.dummy.updateMatrix();
    this.shadows.setMatrixAt(index, this.dummy.matrix);
  }

  private drawCombatIndicators(simulation: Simulation): void {
    const { player, enemies, input } = simulation;
    const recoil = simulation.recoilTicks * 0.025;
    this.weapon.position.set(
      player.x[0] + input.aimX * (0.55 - recoil),
      0.7,
      player.z[0] + input.aimZ * (0.55 - recoil),
    );
    this.weapon.rotation.y = -Math.atan2(input.aimZ, input.aimX);
    this.weapon.visible = simulation.phase !== 'dead';
    this.chargeRing.visible = simulation.chargeTicks > 0;
    this.chargeRing.position.set(player.x[0], 0.045, player.z[0]);
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeRing.scale.setScalar(0.4 + simulation.chargeTicks / 60);
    this.chargeRing.material.color.set(simulation.chargeTicks === 60 ? '#fff8b6' : '#73baa8');
    this.dashBar.position.set(player.x[0], 0.06, player.z[0] + 0.6);
    this.dashBar.rotation.x = -Math.PI / 2;
    this.dashBar.scale.x = Math.max(0.01, 1 - simulation.dashCooldown / 48);
    let count = 0;
    this.swings.count = this.fans.count = 0;
    for (let index = 0; index < enemies.count; index++) {
      const slot = enemies.active[index];
      const kind = enemies.kind[slot];
      const windup = enemies.state[slot] === 1;
      const shield = kind === 2 && enemies.state[slot] !== 3;
      const fan = kind === 3 && enemies.attack[slot] % 3 === 2;
      if (windup && (kind === 2 || fan)) {
        const mesh = fan ? this.fans : this.swings;
        const radius = fan ? 6 : 2.5;
        this.dummy.position.set(enemies.x[slot], 0.055, enemies.z[slot]);
        this.dummy.rotation.set(-Math.PI / 2, 0, -Math.atan2(enemies.facingZ[slot], enemies.facingX[slot]));
        this.dummy.scale.set(radius, radius, 1);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(mesh.count++, this.dummy.matrix);
      }
      if (!windup && !shield) continue;
      const length = shield ? 0.12 : kind === 0 || (kind === 3 && enemies.attack[slot] % 3 === 0) ? 6 : 1.8;
      this.dummy.position.set(
        enemies.x[slot] + enemies.facingX[slot] * (shield ? 0.6 : length / 2),
        0.08,
        enemies.z[slot] + enemies.facingZ[slot] * (shield ? 0.6 : length / 2),
      );
      this.dummy.rotation.set(0, -Math.atan2(enemies.facingZ[slot], enemies.facingX[slot]), 0);
      this.dummy.scale.set(length, shield ? 20 : 1, shield ? 1.15 : 0.55);
      this.dummy.updateMatrix();
      this.warnings.setMatrixAt(count, this.dummy.matrix);
      this.warnings.setColorAt(count++, this.tint.set(shield ? '#b5d4ff' : '#ff9d65'));
    }
    this.warnings.count = count;
    this.warnings.instanceMatrix.needsUpdate = true;
    if (this.warnings.instanceColor) this.warnings.instanceColor.needsUpdate = true;
    this.swings.instanceMatrix.needsUpdate = this.fans.instanceMatrix.needsUpdate = true;
  }

  private drawEffects(simulation: Simulation): void {
    this.dummy.rotation.set(-Math.PI / 2, 0, 0);
    let zoneCount = 0;
    for (const zone of simulation.zones) {
      if (zoneCount >= this.zoneRings.instanceMatrix.count) break;
      const active = simulation.combatTick >= zone.startsAt;
      this.dummy.position.set(zone.x, 0.035, zone.z);
      this.dummy.scale.set(zone.radius, zone.radius, 1);
      this.dummy.updateMatrix();
      const color = zone.kind === 'trail' ? '#82f7c1' : active ? '#ff775b' : '#d6a5ff';
      for (const mesh of [this.zoneRings, this.zoneFills]) {
        mesh.setMatrixAt(zoneCount, this.dummy.matrix);
        mesh.setColorAt(zoneCount, this.tint.set(color));
      }
      zoneCount++;
    }
    for (const mesh of [this.zoneRings, this.zoneFills]) {
      mesh.count = zoneCount;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    let count = 0;
    for (const effect of simulation.visuals) {
      const progress = (simulation.combatTick - effect.born) / effect.duration;
      const size =
        effect.kind === 'death'
          ? 0.4 + progress
          : effect.kind === 'afterimage'
            ? 0.45 * (1 - progress)
            : 0.15 + progress * 0.35;
      this.dummy.position.set(effect.x, effect.kind === 'afterimage' ? 0.35 : 0.5, effect.z);
      this.dummy.quaternion.copy(this.camera.quaternion);
      this.dummy.scale.set(size, size, 1);
      this.dummy.updateMatrix();
      this.sparks.setMatrixAt(count, this.dummy.matrix);
      this.sparks.setColorAt(
        count++,
        this.tint.set(effect.kind === 'afterimage' ? '#84cdb4' : effect.kind === 'block' ? '#9cbeff' : '#ffdc99'),
      );
    }
    this.sparks.count = count;
    this.sparks.instanceMatrix.needsUpdate = true;
    if (this.sparks.instanceColor) this.sparks.instanceColor.needsUpdate = true;
  }

  aim(clientX: number, clientY: number): THREE.Vector3 {
    const bounds = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      1 - ((clientY - bounds.top) / bounds.height) * 2,
    );
    this.ray.setFromCamera(this.pointer, this.camera);
    this.ray.ray.intersectPlane(this.ground, this.target);
    return this.target;
  }

  private disposeTerrain(): void {
    this.terrain.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      (object.material as THREE.Material).dispose();
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    this.terrain.clear();
  }

  dispose(): void {
    this.disposeTerrain();
    for (const mesh of [
      this.actors.mesh,
      this.bullets,
      this.shadows,
      this.zoneRings,
      this.zoneFills,
      this.warnings,
      this.swings,
      this.fans,
      this.sparks,
    ]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    for (const mesh of [this.weapon, this.chargeRing, this.dashBar]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.texture.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
