// Three.js FPS engine for The Big Con Battle Royale
// Renders the world from the local player's POV, interpolates remote players,
// sends inputs to the host (or applies locally for the host).

import * as THREE from "three";
import {
  GAME,
  NODES,
  WEAPONS,
  MOODS,
  CHAR_URL,
  charById,
  type WeaponId,
  type MoodKey,
} from "./constants";
import type {
  GameState,
  PlayerState,
  ProjectileState,
  LootState,
} from "./types";

type SendInputFn = (input: {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  yaw: number;
  pitch: number;
  ts: number;
}) => void;

type SendShootFn = (
  weapon: WeaponId,
  pos: [number, number, number],
  dir: [number, number, number]
) => void;

type SendAbilityFn = () => void;
type SendSwitchWeaponFn = (w: WeaponId) => void;
type SendCaptureFn = (nodeId: string, start: boolean) => void;

export type FpsEngineCallbacks = {
  sendInput: SendInputFn;
  sendShoot: SendShootFn;
  sendAbility: SendAbilityFn;
  sendSwitchWeapon: SendSwitchWeaponFn;
  sendCapture: SendCaptureFn;
  onHitMarker: (color: string) => void;
  onDamage: (fromIdx: number) => void;
  onPickup: (label: string, color: string) => void;
  onKill: (killerName: string, victimName: string, weapon: string) => void;
  onPointerLockChange: (locked: boolean) => void;
  onCaptureProgress: (nodeId: string | null, progress: number) => void;
};

export class FpsEngine {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock: { getDelta: () => number; start: () => void };
  private rafId: number = 0;
  private cb: FpsEngineCallbacks;

  // Local state
  private keys: Record<string, boolean> = {};
  private yaw: number = 0;
  private pitch: number = 0;
  private locked: boolean = false;
  private myIdx: number = 0;
  private isHost: boolean = false;
  private currentWeapon: WeaponId = "LEAK";

  // Visuals
  private playerMeshes: Map<number, THREE.Group> = new Map();
  private projectileMeshes: Map<number, THREE.Mesh> = new Map();
  private lootMeshes: Map<number, THREE.Object3D> = new Map();
  private nodeMeshes: Map<string, THREE.Object3D> = new Map();
  private nodeHalos: Map<string, THREE.Mesh> = new Map();
  private zoneMesh!: THREE.Mesh;
  private zoneTargetMesh!: THREE.Mesh;

  // Input throttling
  private lastInputSend: number = 0;
  private lastShotMs: number = 0;
  private weaponDef = (id: WeaponId) => WEAPONS.find((w) => w.id === id)!;

  // State cache
  private lastState: GameState | null = null;

  // Capture visualization
  private currentCaptureNodeId: string | null = null;

  // For local host prediction
  private localPos: THREE.Vector3 = new THREE.Vector3();
  private localVel: THREE.Vector3 = new THREE.Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    myIdx: number,
    isHost: boolean,
    cb: FpsEngineCallbacks
  ) {
    this.canvas = canvas;
    this.myIdx = myIdx;
    this.isHost = isHost;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c0b);
    this.scene.fog = new THREE.Fog(0x0a0c0b, 80, 240);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      500
    );

    // Lightweight clock replacement (THREE.Clock is deprecated in r186+).
    let lastTs = performance.now();
    this.clock = {
      start: () => {
        lastTs = performance.now();
      },
      getDelta: () => {
        const now = performance.now();
        const d = (now - lastTs) / 1000;
        lastTs = now;
        return d;
      },
    };

    this.buildWorld();
    this.bindEvents();
  }

  // ============ World construction ============

  private buildWorld() {
    // Lights — brighter than the original board game's palette so the 3D
    // arena is readable while keeping the teal/charcoal identity.
    const hemi = new THREE.HemisphereLight(0x2d5f60, 0x0a0c0b, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xcfeae6, 1.4);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 250;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x168388, 0.4);
    fill.position.set(-30, 30, -20);
    this.scene.add(fill);
    const ambient = new THREE.AmbientLight(0x1a3a3a, 0.4);
    this.scene.add(ambient);

    // Ground — dark charcoal with grid
    const groundGeo = new THREE.PlaneGeometry(
      GAME.WORLD_SIZE,
      GAME.WORLD_SIZE,
      40,
      40
    );
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x1a201f,
      roughness: 0.9,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid overlay — brighter teal
    const grid = new THREE.GridHelper(
      GAME.WORLD_SIZE,
      40,
      0x168388,
      0x0a2a2c
    );
    (grid.material as THREE.Material).opacity = 0.35;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.02;
    this.scene.add(grid);

    // Outer wall
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x0a2a2c,
      roughness: 0.9,
      metalness: 0.1,
    });
    const wallH = 8;
    const half = GAME.WORLD_SIZE / 2;
    const walls: Array<[number, number, number, number]> = [
      [0, wallH / 2, -half, GAME.WORLD_SIZE, wallH, 1],
      [0, wallH / 2, half, GAME.WORLD_SIZE, wallH, 1],
      [-half, wallH / 2, 0, 1, wallH, GAME.WORLD_SIZE],
      [half, wallH / 2, 0, 1, wallH, GAME.WORLD_SIZE],
    ];
    for (const [x, y, z, sx, sy, sz] of walls) {
      const w = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        wallMat
      );
      w.position.set(x, y, z);
      w.castShadow = true;
      w.receiveShadow = true;
      this.scene.add(w);
    }

    // Build nodes
    for (const node of NODES) {
      this.buildNode(node);
    }

    // Zone visualization
    const zoneGeo = new THREE.RingGeometry(
      GAME.ZONE_START_RADIUS - 0.3,
      GAME.ZONE_START_RADIUS,
      96
    );
    const zoneMat = new THREE.MeshBasicMaterial({
      color: 0xff6b5e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.7,
    });
    this.zoneMesh = new THREE.Mesh(zoneGeo, zoneMat);
    this.zoneMesh.rotation.x = -Math.PI / 2;
    this.zoneMesh.position.y = 0.1;
    this.scene.add(this.zoneMesh);

    // Target zone (during shrink)
    const targetGeo = new THREE.RingGeometry(
      GAME.ZONE_START_RADIUS - 0.15,
      GAME.ZONE_START_RADIUS,
      96
    );
    const targetMat = new THREE.MeshBasicMaterial({
      color: 0xffa94d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
    });
    this.zoneTargetMesh = new THREE.Mesh(targetGeo, targetMat);
    this.zoneTargetMesh.rotation.x = -Math.PI / 2;
    this.zoneTargetMesh.position.y = 0.08;
    this.zoneTargetMesh.visible = false;
    this.scene.add(this.zoneTargetMesh);
  }

  private buildNode(node: (typeof NODES)[number]) {
    const group = new THREE.Group();
    group.position.set(node.pos[0], 0, node.pos[2]);

    // Building — a stylized low-poly tower with a brand texture
    const heights: Record<string, number> = {
      BANK: 14,
      REGULATOR: 10,
      CHART: 6,
      WILD: 8,
      CORPORATE: 18,
      COMMODITY: 5,
      MEDIA: 8,
    };
    const h = heights[node.type] || 8;
    const w = node.radius * 0.85;
    const buildingGeo = new THREE.BoxGeometry(w, h, w);
    const buildingMat = new THREE.MeshStandardMaterial({
      color: this.typeColor(node.type),
      roughness: 0.7,
      metalness: 0.25,
    });
    const building = new THREE.Mesh(buildingGeo, buildingMat);
    building.position.y = h / 2;
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);

    // Brand image on a "billboard" on top
    const tex = new THREE.TextureLoader().load(node.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    const billGeo = new THREE.PlaneGeometry(w * 1.1, w * 1.1);
    const billMat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const billboard = new THREE.Mesh(billGeo, billMat);
    billboard.position.y = h + w * 0.55;
    billboard.lookAt(0, h + w * 0.55, 0);
    group.add(billboard);

    // Capture ring on the ground
    const ringGeo = new THREE.RingGeometry(
      node.radius - 0.3,
      node.radius,
      48
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x168388,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    group.add(ring);

    // Halo (for owned state — initially invisible)
    const haloGeo = new THREE.RingGeometry(
      node.radius - 0.1,
      node.radius + 0.4,
      48
    );
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xf5c542,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.07;
    group.add(halo);
    this.nodeHalos.set(node.id, halo);

    // Label sprite
    const label = this.makeTextSprite(node.name.join(" "), "#9ad");
    label.position.y = h + w * 1.4;
    label.scale.set(w * 1.6, w * 0.4, 1);
    group.add(label);

    this.scene.add(group);
    this.nodeMeshes.set(node.id, group);
  }

  private typeColor(t: string): number {
    switch (t) {
      case "BANK": return 0x1f3a5f;
      case "REGULATOR": return 0x4a5a66;
      case "CHART": return 0x2d4a3a;
      case "WILD": return 0x5a2a4a;
      case "CORPORATE": return 0x2a3a5a;
      case "COMMODITY": return 0x4a3a1f;
      case "MEDIA": return 0x5a1f3a;
      default: return 0x333333;
    }
  }

  private makeTextSprite(text: string, color: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 48px 'Times New Roman', serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const sprite = new THREE.Sprite(mat);
    return sprite;
  }

  // ============ Events ============

  private bindEvents() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("wheel", this.onWheel, { passive: true });
    window.addEventListener("resize", this.onResize);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.renderer.dispose();
  }

  requestPointerLock() {
    this.canvas.requestPointerLock();
  }

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    this.cb.onPointerLockChange(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.locked) return;
    this.keys[e.code] = true;
    if (e.code === "KeyR") {
      // Reload / ability
      this.cb.sendAbility();
    }
    if (e.code === "KeyE") {
      // Capture toggle — find node in range
      const myPlayer = this.lastState?.players[this.myIdx];
      if (myPlayer) {
        for (const node of NODES) {
          const dx = myPlayer.pos[0] - node.pos[0];
          const dz = myPlayer.pos[2] - node.pos[2];
          if (Math.sqrt(dx * dx + dz * dz) < node.radius) {
            this.cb.sendCapture(node.id, true);
            break;
          }
        }
      }
    }
    if (e.code === "Tab") {
      e.preventDefault();
    }
    // Weapon switching 1-5
    const slotMap: Record<string, WeaponId> = {
      Digit1: "LEAK",
      Digit2: "AUDIT",
      Digit3: "TWEET",
      Digit4: "SPIN",
      Digit5: "ROAST",
    };
    if (slotMap[e.code]) {
      this.currentWeapon = slotMap[e.code];
      this.cb.sendSwitchWeapon(this.currentWeapon);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    const sensitivity = 0.0025;
    this.yaw -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
  };

  private mouseDown: boolean = false;
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.tryShoot();
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    const weapons: WeaponId[] = ["LEAK", "AUDIT", "TWEET", "SPIN", "ROAST"];
    const idx = weapons.indexOf(this.currentWeapon);
    const next = e.deltaY > 0 ? (idx + 1) % weapons.length : (idx - 1 + weapons.length) % weapons.length;
    this.currentWeapon = weapons[next];
    this.cb.sendSwitchWeapon(this.currentWeapon);
  };

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  };

  private tryShoot() {
    const nowMs = Date.now();
    const w = this.weaponDef(this.currentWeapon);
    if (nowMs - this.lastShotMs < w.fireRateMs) return;
    this.lastShotMs = nowMs;
    // Compute muzzle pos and dir from camera
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const pos = this.camera.position.clone().add(dir.clone().multiplyScalar(0.5));
    this.cb.sendShoot(this.currentWeapon, [pos.x, pos.y, pos.z], [dir.x, dir.y, dir.z]);
    // Visual: muzzle flash
    this.spawnMuzzleFlash(pos, w.projectileColor);
  }

  private spawnMuzzleFlash(pos: THREE.Vector3, color: number) {
    const geo = new THREE.SphereGeometry(0.15, 8, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    this.scene.add(m);
    setTimeout(() => {
      this.scene.remove(m);
      geo.dispose();
      mat.dispose();
    }, 80);
  }

  // ============ Update loop ============

  start() {
    this.clock.start();
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);
      this.update();
    };
    loop();
  }

  private update() {
    const dt = this.clock.getDelta();
    const nowMs = Date.now();

    // Send input
    if (this.locked && this.lastState) {
      const input = {
        forward: !!this.keys["KeyW"],
        back: !!this.keys["KeyS"],
        left: !!this.keys["KeyA"],
        right: !!this.keys["KeyD"],
        jump: !!this.keys["Space"],
        sprint: !!this.keys["ShiftLeft"] || !!this.keys["ShiftRight"],
        yaw: this.yaw,
        pitch: this.pitch,
        ts: nowMs,
      };
      // Send at ~30Hz
      if (nowMs - this.lastInputSend > 33) {
        this.cb.sendInput(input);
        this.lastInputSend = nowMs;
      }
      // Local prediction for the host's own player (smoother feel)
      if (this.isHost) {
        // Host runs authoritative sim elsewhere; here we just sync the camera.
      }
    }

    // Auto-fire while held
    if (this.mouseDown && this.locked) {
      this.tryShoot();
    }

    // Camera follows local player
    if (this.lastState && this.lastState.players[this.myIdx]) {
      const p = this.lastState.players[this.myIdx];
      if (p.alive) {
        this.camera.position.set(
          p.pos[0],
          p.pos[1] + GAME.PLAYER_HEIGHT - 0.1,
          p.pos[2]
        );
        // Apply look rotation
        this.camera.rotation.order = "YXZ";
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
        // If host, also reflect yaw/pitch back to state so host sim reads correctly
        if (this.isHost) {
          p.yaw = this.yaw;
          p.pitch = this.pitch;
        }
      }
    }

    // Update remote player meshes
    if (this.lastState) {
      this.updatePlayerMeshes();
      this.updateProjectiles();
      this.updateLoot();
      this.updateNodes();
      this.updateZone();
    }

    this.renderer.render(this.scene, this.camera);
  }

  // ============ Apply state from host ============

  applyState(s: GameState) {
    const prev = this.lastState;
    this.lastState = s;

    // Detect hit markers: did any of my projectiles disappear with a hit?
    // Simpler: scan fx for "HIT" entries near my character
    // Actually we want to know if I damaged someone. We can compare killFeed.
    if (prev) {
      for (const kf of s.killFeed) {
        if (!prev.killFeed.find((k) => k.id === kf.id)) {
          // New kill
          const killer = kf.killerIdx >= 0 ? s.players[kf.killerIdx]?.name : "REGULATORS";
          const victim = s.players[kf.victimIdx]?.name || "unknown";
          this.cb.onKill(killer || "REGULATORS", victim, kf.weapon);
        }
      }
      // Pickup detection: my money/intel/cortisol changed without obvious cause
      const me = s.players[this.myIdx];
      const prevMe = prev.players[this.myIdx];
      if (me && prevMe) {
        if (me.money > prevMe.money + 0.5) {
          // Could be node income or pickup — only fire if large jump
          if (me.money - prevMe.money >= 5) {
            this.cb.onPickup(`+$${Math.round(me.money - prevMe.money)}`, "#7fe08d");
          }
        }
      }
    }
  }

  private updatePlayerMeshes() {
    if (!this.lastState) return;
    const seen = new Set<number>();
    for (let i = 0; i < this.lastState.players.length; i++) {
      if (i === this.myIdx) continue;
      const p = this.lastState.players[i];
      seen.add(i);
      let mesh = this.playerMeshes.get(i);
      if (!mesh) {
        mesh = this.buildPlayerMesh(p);
        this.playerMeshes.set(i, mesh);
        this.scene.add(mesh);
      }
      // Position
      mesh.position.set(p.pos[0], 0, p.pos[2]);
      mesh.rotation.y = p.yaw + Math.PI;
      // Visibility: cloaked players are translucent
      const isCloaked = p.cloakedUntil > Date.now();
      mesh.traverse((o) => {
        if ((o as THREE.Mesh).material) {
          const m = (o as THREE.Mesh).material as THREE.Material & {
            opacity?: number;
            transparent?: boolean;
          };
          if (m && "opacity" in m) {
            m.transparent = true;
            m.opacity = isCloaked ? 0.18 : 1;
          }
        }
      });
      // Visibility: dead = invisible
      mesh.visible = p.alive;
      // Update name + status bar
      const tag = mesh.userData.tag as THREE.Sprite | undefined;
      if (tag) {
        const me = this.lastState.players[this.myIdx];
        const showCortisol = me?.charId === "calvinathanasius" || i === this.myIdx;
        const label = `${p.name}${showCortisol ? ` (${p.cortisol}🔥)` : ""}`;
        // Only rebuild if name changed
        if (mesh.userData.lastLabel !== label) {
          mesh.userData.lastLabel = label;
          this.updateSpriteText(tag, label, p.color);
        }
        tag.position.y = 3.2;
      }
      // Health/cortisol bar above
      const bar = mesh.userData.bar as THREE.Mesh | undefined;
      if (bar) {
        const ratio = 1 - p.cortisol / p.cortisolCap;
        bar.scale.y = Math.max(0.01, ratio);
        bar.position.y = 2.7;
        const mat = bar.material as THREE.MeshBasicMaterial;
        mat.color.set(ratio > 0.5 ? 0x7fe08d : ratio > 0.25 ? 0xf5c542 : 0xff6b5e);
      }
    }
    // Remove meshes for gone players
    for (const [idx, mesh] of this.playerMeshes) {
      if (!seen.has(idx)) {
        this.scene.remove(mesh);
        this.playerMeshes.delete(idx);
      }
    }
  }

  private buildPlayerMesh(p: PlayerState): THREE.Group {
    const group = new THREE.Group();
    // Body capsule
    const bodyGeo = new THREE.CapsuleGeometry(0.5, 1.2, 4, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(p.color),
      roughness: 0.6,
      metalness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.2;
    body.castShadow = true;
    group.add(body);
    // Head
    const headGeo = new THREE.SphereGeometry(0.45, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xf2d0a0,
      roughness: 0.7,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 2.4;
    head.castShadow = true;
    group.add(head);
    // Character face texture (billboard)
    if (p.charId) {
      const char = charById(p.charId);
      if (char) {
        const tex = new THREE.TextureLoader().load(CHAR_URL + char.file);
        tex.colorSpace = THREE.SRGBColorSpace;
        const faceGeo = new THREE.PlaneGeometry(0.8, 0.8);
        const faceMat = new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
        });
        const face = new THREE.Mesh(faceGeo, faceMat);
        face.position.set(0, 2.45, 0.43);
        group.add(face);
      }
    }
    // Weapon in hands (simple box)
    const gunGeo = new THREE.BoxGeometry(0.15, 0.15, 0.7);
    const gunMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.4,
      metalness: 0.8,
    });
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.35, 1.4, 0.4);
    group.add(gun);
    // Name tag sprite
    const tag = this.makeTextSprite(p.name, p.color);
    tag.scale.set(3, 0.75, 1);
    group.add(tag);
    group.userData.tag = tag;
    // Cortisol bar
    const barGeo = new THREE.PlaneGeometry(1.4, 0.16);
    const barMat = new THREE.MeshBasicMaterial({ color: 0x7fe08d });
    const bar = new THREE.Mesh(barGeo, barMat);
    bar.position.y = 2.7;
    group.add(bar);
    group.userData.bar = bar;
    return group;
  }

  private updateSpriteText(sprite: THREE.Sprite, text: string, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = "bold 44px 'Times New Roman', serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    (sprite.material as THREE.SpriteMaterial).map?.dispose();
    (sprite.material as THREE.SpriteMaterial).map = tex;
    (sprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  private updateProjectiles() {
    if (!this.lastState) return;
    const seen = new Set<number>();
    for (const proj of this.lastState.projectiles) {
      seen.add(proj.id);
      let mesh = this.projectileMeshes.get(proj.id);
      if (!mesh) {
        const w = WEAPONS.find((x) => x.id === proj.weapon);
        const geo = new THREE.SphereGeometry(0.18, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
          color: w?.projectileColor || 0x55c1ff,
        });
        mesh = new THREE.Mesh(geo, mat);
        this.projectileMeshes.set(proj.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(proj.pos[0], proj.pos[1], proj.pos[2]);
    }
    // Remove stale
    for (const [id, mesh] of this.projectileMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }
  }

  private updateLoot() {
    if (!this.lastState) return;
    const seen = new Set<number>();
    for (const item of this.lastState.loot) {
      seen.add(item.id);
      let mesh = this.lootMeshes.get(item.id);
      if (!mesh) {
        mesh = this.buildLootMesh(item);
        this.lootMeshes.set(item.id, mesh);
        this.scene.add(mesh);
      }
      // Bob animation
      mesh.position.y = 0.5 + Math.sin(Date.now() * 0.003 + item.id) * 0.2;
      mesh.rotation.y = Date.now() * 0.001 + item.id;
    }
    for (const [id, mesh] of this.lootMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.lootMeshes.delete(id);
      }
    }
  }

  private buildLootMesh(item: LootState): THREE.Object3D {
    let geo: THREE.BufferGeometry;
    if (item.mesh === "cash") {
      geo = new THREE.BoxGeometry(0.8, 0.3, 0.5);
    } else if (item.mesh === "intel") {
      geo = new THREE.BoxGeometry(0.6, 0.8, 0.05);
    } else if (item.mesh === "shoe") {
      geo = new THREE.BoxGeometry(0.5, 0.3, 1.0);
    } else {
      // magnet
      geo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: item.color,
      roughness: 0.5,
      metalness: 0.3,
      emissive: item.color,
      emissiveIntensity: 0.4,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(item.pos[0], 0.5, item.pos[2]);
    m.castShadow = true;
    // Add a halo
    const haloGeo = new THREE.RingGeometry(0.7, 0.9, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: item.color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.45;
    m.add(halo);
    return m;
  }

  private updateNodes() {
    if (!this.lastState) return;
    for (const node of NODES) {
      const ownerIdx = this.lastState.owner[node.id];
      const halo = this.nodeHalos.get(node.id);
      if (halo) {
        if (ownerIdx != null && ownerIdx >= 0) {
          const p = this.lastState.players[ownerIdx];
          const c = p ? new THREE.Color(p.color) : new THREE.Color(0xf5c542);
          (halo.material as THREE.MeshBasicMaterial).color = c;
          (halo.material as THREE.MeshBasicMaterial).opacity = 0.8;
        } else {
          (halo.material as THREE.MeshBasicMaterial).opacity = 0;
        }
      }
    }
    // Capture progress
    let curCapture: string | null = null;
    let progress = 0;
    for (const nid in this.lastState.capture) {
      const c = this.lastState.capture[nid];
      if (c.idx === this.myIdx) {
        curCapture = nid;
        progress = Math.min(1, (Date.now() - c.startedAt) / GAME.CAPTURE_TIME_MS);
        break;
      }
    }
    if (curCapture !== this.currentCaptureNodeId) {
      this.currentCaptureNodeId = curCapture;
    }
    this.cb.onCaptureProgress(curCapture, progress);
  }

  private updateZone() {
    if (!this.lastState) return;
    this.zoneMesh.position.set(this.lastState.zoneCenter[0], 0.1, this.lastState.zoneCenter[2]);
    this.zoneMesh.scale.setScalar(this.lastState.zoneRadius / GAME.ZONE_START_RADIUS);
    // Mood tint on zone
    const mood = MOODS[this.lastState.mood as MoodKey];
    if (mood) {
      (this.zoneMesh.material as THREE.MeshBasicMaterial).color.set(mood.color);
    }
    // Target visualization during shrink
    if (this.lastState.zonePhase === "SHRINKING") {
      this.zoneTargetMesh.visible = true;
      this.zoneTargetMesh.position.set(
        this.lastState.zoneTargetCenter[0],
        0.08,
        this.lastState.zoneTargetCenter[1]
      );
      this.zoneTargetMesh.scale.setScalar(this.lastState.zoneTargetRadius / GAME.ZONE_START_RADIUS);
    } else {
      this.zoneTargetMesh.visible = false;
    }
  }

  // ============ Public API ============

  setWeapon(w: WeaponId) {
    this.currentWeapon = w;
  }

  getWeapon(): WeaponId {
    return this.currentWeapon;
  }

  triggerHitMarker(color: string) {
    this.cb.onHitMarker(color);
  }
}
