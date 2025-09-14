import * as THREE from 'three';
import { VoxelEngine } from './engine-core.js';
import { PlayerControls } from './player-controls.js';
import { UIManager } from './ui-manager.js';
import { updatePhysics } from './renderer-physics.js';
import { installBlockInteractions, raycastVoxel } from './renderer-interactions.js';

export class VoxelRenderer {
    constructor(options = {}) {
        this.canvas = document.getElementById('canvas');
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance' });
        this.engineOptions = options;
        this.isCreative = (this.engineOptions?.gamemode === 'creative');
        this.voxelEngine = new VoxelEngine(this.engineOptions);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = false;
        // ensure correct color pipeline (prevents washed-out textures)
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.velocity = new THREE.Vector3();
        this.isMobile = /Android|webOS|iPhone|iPad|IEMobile|Opera Mini/i.test(navigator.userAgent);
        this.playerControls = new PlayerControls(this.canvas, this.camera, this.velocity, 10, 0.002, this.isMobile, true);
        this.uiManager = new UIManager(this.camera);
        // wire per-world persist key to hotbar so inventory saves per-world
        this.uiManager.hotbar?.setPersistKey?.(this.voxelEngine._persistKey || 'voxel_saved_edits_v1');
        // load inventory now that the correct per-world persist key is set
        this.uiManager.hotbar?.loadInventory?.();
        this.uiUpdateInterval = 0.1; this.uiAccum = 0;
        this.lastRenderDistance = this.uiManager.getRenderDistance();
        this.lastFov = this.uiManager.getFOV();
        this.lastLodScale = this.uiManager.getLODScale?.() || 1;
        this.currentFps = 0;
        this.player = { radius: 0.4, height: 1.8, eyeHeight: 1.6, vel: new THREE.Vector3(0,0,0), grounded: false };
        this.selectedBlockId = 1;
        this.selectedUV = null;
        window.addEventListener('hotbar-select', (e) => {
            const fromInventory = e.detail?.index === -1;
            const u = e.detail?.u, v = e.detail?.v;
            const hasUV = Number.isFinite(u) && Number.isFinite(v);
            let id = Number(e.detail?.id) || 0;
            if (id > 0) {
                this.selectedBlockId = id;
            } else if (fromInventory && hasUV && this.voxelEngine?.registerUVBlock) {
                this.selectedBlockId = this.voxelEngine.registerUVBlock(u, v);
            } else if (hasUV && this.voxelEngine?.registerUVBlock) {
                this.selectedBlockId = this.voxelEngine.registerUVBlock(u, v);
            } else {
                // empty selection clears the current block
                this.selectedBlockId = 0;
            }
        });

        // bind helpers from split modules
        this._raycastVoxel = (origin, dir, maxDist) => raycastVoxel(this, origin, dir, maxDist);
        this.installBlockInteractions = () => installBlockInteractions(this);
        this.updatePhysics = (dt) => updatePhysics(this, dt);
    }

    async init() {
        this.renderer.setClearColor(0x87CEEB);
        this.scene.fog = null;
        this.camera.position.set(0, 80, 0);
        this.camera.rotation.order = 'YXZ';
        this.camera.far = this.uiManager.getRenderDistance() * 1.5;
        this.camera.updateProjectionMatrix();
        await this.voxelEngine.initResources();
        try {
            const persistKey = this.voxelEngine._persistKey || 'voxel_saved_edits_v1';
            const raw = localStorage.getItem(`${persistKey}:player`);
            if (raw) {
                const s = JSON.parse(raw);
                if (s?.pos) this.camera.position.set(s.pos.x, s.pos.y, s.pos.z);
                if (s?.rot) this.camera.rotation.set(s.rot.x, s.rot.y, s.rot.z);
                this.player.vel.set(0,0,0);
            }
        } catch (e) { console.warn('Failed to load player state', e); }
        try {
            const cx = Math.floor(this.camera.position.x / this.voxelEngine.chunkSizeX);
            const cz = Math.floor(this.camera.position.z / this.voxelEngine.chunkSizeZ);
            // Ensure nearby chunks are requested for generation via the engine (worker or pumpGeneration).
            // Avoid synchronous main-thread generation to prevent a briefly different/flattened preview.
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                this.voxelEngine.generateChunk(cx + dx, cz + dz);
            }
            const isColliding = () => {
                const r = this.player.radius, h = this.player.height, eye = this.player.eyeHeight;
                const pos = this.camera.position;
                const minX = Math.floor(pos.x - r), maxX = Math.floor(pos.x + r);
                const minY = Math.floor(pos.y - eye), maxY = Math.floor(pos.y - eye + h);
                const minZ = Math.floor(pos.z - r), maxZ = Math.floor(pos.z + r);
                for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
                    if (this.voxelEngine.isVoxelSolidWorld(0, 0, x, y, z)) return true;
                }
                return false;
            };
            let attempts = 0;
            while (isColliding() && attempts < 20) { this.camera.position.y += 0.5; attempts++; }
            this.player.vel.set(0, 0, 0);
        } catch {}
        this.voxelEngine.onRenderDistanceChanged(this.camera.position, this.uiManager.getRenderDistance());
        window.addEventListener('resize', () => this.onWindowResize());
        if (this.uiManager.renderDistanceValueEl) this.uiManager.renderDistanceValueEl.textContent = this.uiManager.getRenderDistance();
        if (this.uiManager.fovValueEl) this.uiManager.fovValueEl.textContent = this.uiManager.getFOV();
        const toggleBtn = document.getElementById('uiToggle');
        if (toggleBtn) {
            document.body.classList.toggle('ui-open', !this.isMobile);
            toggleBtn.addEventListener('click', () => { document.body.classList.toggle('ui-open'); });
        }
        const optionsBtn = document.getElementById('optionsBtn');
        const overlay = document.getElementById('optionsOverlay');
        const closeBtn = document.getElementById('closeOptions');
        const openOverlay = () => {
            const isInGame = document.getElementById('mainMenu')?.classList.contains('hidden');
            overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false');
            overlay.querySelectorAll('.coord-inputs').forEach(el => { el.style.display = isInGame ? '' : 'none'; });
        };
        const closeOverlay = () => { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true'); };
        optionsBtn?.addEventListener('click', openOverlay);
        closeBtn?.addEventListener('click', closeOverlay);
        overlay?.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
        window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); console.warn('Unhandled promise rejection:', e.reason); });
        this.installBlockInteractions();
        window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); console.warn('Unhandled promise rejection:', e.reason); });
        const savePlayerState = () => {
            try {
                const persistKey = this.voxelEngine._persistKey || 'voxel_saved_edits_v1';
                const s = { pos: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }, rot: { x: this.camera.rotation.x, y: this.camera.rotation.y, z: this.camera.rotation.z } };
                localStorage.setItem(`${persistKey}:player`, JSON.stringify(s));
            } catch (e) { console.warn('Failed to save player state', e); }
        };
        this._playerSaveInterval = setInterval(savePlayerState, 2000);
        window.addEventListener('beforeunload', savePlayerState);
        document.addEventListener('visibilitychange', () => { if (document.hidden) savePlayerState(); });
        this.paused = false;
        this.pauseOverlay = document.getElementById('pauseOverlay');
        this.resumeBtn = document.getElementById('resumeBtn');
        this.pauseOptionsBtn = document.getElementById('pauseOptionsBtn');
        this.returnMainMenuBtn = document.getElementById('returnMainMenuBtn');
        this._onKeyDownForPause = (e) => {
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (e.key === 'Escape') { e.preventDefault(); if (this.paused) this.resume(); else this.pause(); }
        };
        window.addEventListener('keydown', this._onKeyDownForPause);
        this.resumeBtn?.addEventListener('click', () => this.resume());
        this.pauseOptionsBtn?.addEventListener('click', () => {
            const overlay = document.getElementById('optionsOverlay');
            if (!overlay) return;
            overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
            overlay.querySelectorAll('.coord-inputs').forEach(el => el.style.display = '');
        });
        this.returnMainMenuBtn?.addEventListener('click', () => { try { clearInterval(this._playerSaveInterval); } catch {} location.reload(); });
        const overlayEl = document.getElementById('optionsOverlay');
        overlayEl?.addEventListener('click', (e) => { if (e.target === overlayEl) overlayEl.classList.remove('open'); });
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(1);
    }

    animate() {
        if (this.paused) return;
        const now = performance.now();
        if (!this.lastFrame) this.lastFrame = now;
        const deltaTime = Math.min((now - this.lastFrame) / 1000, 1 / 30);
        this.lastFrame = now;
        this.frameCount = (this.frameCount || 0) + 1;
        if (!this.lastFpsUpdate) { this.lastFpsUpdate = now; this.currentFps = 0; }
        if (now - this.lastFpsUpdate >= 1000) {
            const instantFps = this.frameCount;
            this.currentFps = Math.round(this.currentFps ? (this.currentFps * 0.5 + instantFps * 0.5) : instantFps);
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
        this.playerControls.update(deltaTime);
        this.updatePhysics(deltaTime);
        const rd = this.uiManager.getRenderDistance();
        const fov = this.uiManager.getFOV();
        if (rd !== this.lastRenderDistance || fov !== this.lastFov) {
            this.camera.far = rd * 1.5; this.camera.fov = fov; this.camera.updateProjectionMatrix();
            if (rd !== this.lastRenderDistance) this.voxelEngine.onRenderDistanceChanged(this.camera.position, rd);
            this.lastRenderDistance = rd; this.lastFov = fov;
        }
        const lodScale = this.uiManager.getLODScale?.() || 1;
        if (lodScale !== this.lastLodScale) { this.voxelEngine.lodScale = lodScale; this.lastLodScale = lodScale; }
        const stats = this.voxelEngine.update(this.scene, this.camera.position, rd);
        this.voxelEngine.processBuildQueue(this.scene, 6);
        this.uiAccum += deltaTime;
        if (this.uiAccum >= this.uiUpdateInterval) {
            this.uiManager.updateStats(this.currentFps, stats.chunkCount, stats.triangleCount);
            this.uiManager.updateCoords(this.camera.position);
            this.uiAccum = 0;
        }
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(() => this.animate());
    }

    pause() {
        if (this.paused) return;
        this.paused = true;
        this.pauseOverlay?.classList.add('open');
        this.pauseOverlay?.setAttribute('aria-hidden', 'false');
        if (this.playerControls?.setPaused) this.playerControls.setPaused(true);
    }

    resume() {
        if (!this.paused) return;
        this.paused = false;
        this.pauseOverlay?.classList.remove('open');
        this.pauseOverlay?.setAttribute('aria-hidden', 'true');
        if (this.playerControls?.setPaused) this.playerControls.setPaused(false);
        this.lastFrame = performance.now();
        requestAnimationFrame(() => this.animate());
    }

    solidAt(x, y, z) {
        return this.voxelEngine.isVoxelSolidWorld(0, 0, Math.floor(x), Math.floor(y), Math.floor(z));
    }

    showPause() {
        if (!this.pauseOverlay) return;
        this.pauseOverlay.classList.add('open');
        this.pauseOverlay.setAttribute('aria-hidden', 'false');
        try {
            if (document.pointerLockElement) {
                const p = document.exitPointerLock?.();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        } catch (e) {}
    }
}