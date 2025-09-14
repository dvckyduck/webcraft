import { HotbarInventory } from './hotbar-inventory.js';

export class UIManager {
    constructor(camera) {
        this.camera = camera;
        this._optionsKey = 'voxel_options_v1';

        this.posXEl = document.getElementById('hudPosX') || document.getElementById('posX');
        this.posYEl = document.getElementById('hudPosY') || document.getElementById('posY');
        this.posZEl = document.getElementById('hudPosZ') || document.getElementById('posZ');
        this.optionsOverlay = document.getElementById('optionsOverlay');
        // Use overlay-specific IDs to avoid duplicate-id collisions between HUD and overlay
        this.renderDistanceSlider = this.optionsOverlay?.querySelector('#renderDistanceOverlay') || document.getElementById('renderDistance');
        this.renderDistanceValueEl = this.optionsOverlay?.querySelector('#renderDistanceValueOverlay') || document.getElementById('renderDistanceValueHud') || document.getElementById('renderDistanceValue');
        this.fovSlider = this.optionsOverlay?.querySelector('#fovOverlay') || document.getElementById('fov');
        this.fovValueEl = this.optionsOverlay?.querySelector('#fovValueOverlay') || document.getElementById('fovValueHud') || document.getElementById('fovValue');
        this.fpsEl = document.getElementById('fps');
        this.lodScaleSlider = this.optionsOverlay?.querySelector('#lodScaleOverlay');
        this.lodScaleValueEl = this.optionsOverlay?.querySelector('#lodScaleValueOverlay');
        this.coordGroups = Array.from(document.querySelectorAll('.coord-inputs')).map(group => {
            const nums = group.querySelectorAll('input[type="number"]');
            return { group, x: nums[0], y: nums[1], z: nums[2], btn: group.querySelector('button') };
        });
        this.inventoryOverlay = document.getElementById('inventoryOverlay');
        this.hotbarEl = document.getElementById('hotbar');
        this.inventoryGrid = document.getElementById('inventoryGrid');
        this.hotbar = new HotbarInventory();
        this.loadOptions(); // apply persisted options before wiring listeners
        this.setupEventListeners();
        this.syncCoordInputs(); // Initial sync

        // Selection state: default to first hotbar slot if present
        this.selectedHotbarIndex = 0;
    }

    setupEventListeners() {
        this.coordGroups.forEach(({ x, y, z, btn }) => {
            const teleport = () => {
                const xv = parseFloat(x?.value);
                const yv = parseFloat(y?.value);
                const zv = parseFloat(z?.value);
                if (Number.isFinite(xv) && Number.isFinite(yv) && Number.isFinite(zv)) {
                    this.camera.position.set(xv, yv, zv);
                }
            };
            btn?.addEventListener('click', teleport);
            [x, y, z].forEach(inp => inp?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); teleport(); }
                e.stopPropagation();
            }));
        });

        this.coordGroups.forEach(({ x, y, z }) => {
            [x, y, z].forEach(inp => inp?.addEventListener('focus', () => {
                if (inp.value === '' || inp.value == null) this.syncCoordInputs();
            }));
        });

        // UI controls for render distance and FOV
        if (this.renderDistanceSlider) {
            this.renderDistanceSlider.addEventListener('input', (e) => {
                const distance = parseInt(e.target.value);
                if (this.renderDistanceValueEl) this.renderDistanceValueEl.textContent = distance;
                this.saveOptions({ renderDistance: distance });
            });
        }
        if (this.fovSlider) {
            this.fovSlider.addEventListener('input', (e) => {
                const fov = parseInt(e.target.value);
                if (this.fovValueEl) this.fovValueEl.textContent = fov;
                this.saveOptions({ fov: fov });
            });
        }
        if (this.lodScaleSlider) {
            this.lodScaleSlider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                if (this.lodScaleValueEl) this.lodScaleValueEl.textContent = val.toFixed(1);
                this.saveOptions({ lodScale: val });
            });
        }

        // Ensure pressing 'E' toggles inventory (ignore when typing in inputs)
        document.addEventListener('keydown', (e) => {
            // ignore if focused on an input/textarea/select
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (e.code === 'KeyE') {
                e.preventDefault();
                this.hotbar?.toggleInventory?.call(this.hotbar);
            }
        });

        // wire inventory close button
        const closeInvBtn = document.getElementById('closeInventory');
        closeInvBtn?.addEventListener('click', () => { this.hotbar?.toggleInventory?.call(this.hotbar, false); });

        this.hotbar?.bindGlobalShortcuts?.();
    }

    loadOptions() {
        try {
            const raw = localStorage.getItem(this._optionsKey);
            if (!raw) return;
            const opts = JSON.parse(raw || '{}') || {};
            if (opts.renderDistance != null && this.renderDistanceSlider) {
                this.renderDistanceSlider.value = opts.renderDistance;
                if (this.renderDistanceValueEl) this.renderDistanceValueEl.textContent = opts.renderDistance;
            }
            if (opts.fov != null && this.fovSlider) {
                this.fovSlider.value = opts.fov;
                if (this.fovValueEl) this.fovValueEl.textContent = opts.fov;
            }
            if (opts.lodScale != null && this.lodScaleSlider) {
                this.lodScaleSlider.value = opts.lodScale;
                if (this.lodScaleValueEl) this.lodScaleValueEl.textContent = Number(opts.lodScale).toFixed(1);
            }
        } catch (e) { /* ignore corrupted storage */ }
    }

    saveOptions(partial = {}) {
        try {
            const cur = JSON.parse(localStorage.getItem(this._optionsKey) || '{}') || {};
            const merged = Object.assign({}, cur, partial);
            localStorage.setItem(this._optionsKey, JSON.stringify(merged));
        } catch (e) {}
    }

    syncCoordInputs() {
        const x = Math.round(this.camera.position.x);
        const y = Math.round(this.camera.position.y);
        const z = Math.round(this.camera.position.z);
        this.coordGroups.forEach(({ x: xi, y: yi, z: zi }) => {
            if (document.activeElement !== xi && xi) xi.value = x;
            if (document.activeElement !== yi && yi) yi.value = y;
            if (document.activeElement !== zi && zi) zi.value = z;
        });
    }

    updateStats(fps, chunkCount, triangleCount) {
        if (this.fpsEl) this.fpsEl.textContent = fps;
        if (this.chunkCountEl) this.chunkCountEl.textContent = chunkCount ?? 0;
        if (this.triangleCountEl) this.triangleCountEl.textContent = triangleCount ?? 0;
    }

    updateCoords(position) {
        this.posXEl.textContent = Math.round(position.x);
        this.posYEl.textContent = Math.round(position.y);
        this.posZEl.textContent = Math.round(position.z);
        this.syncCoordInputs(); // Keep inputs synced when not editing
    }

    getRenderDistance() {
        const v = parseInt(this.renderDistanceSlider?.value ?? '256');
        return Number.isFinite(v) ? v : 256;
    }

    getFOV() {
        const v = parseInt(this.fovSlider?.value ?? '75');
        return Number.isFinite(v) ? v : 75;
    }

    getLODScale() {
        const v = parseFloat(this.lodScaleSlider?.value ?? '1');
        return Number.isFinite(v) ? v : 1;
    }
}