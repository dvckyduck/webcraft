import * as THREE from 'three';

/* exported function raycastVoxel */
export function raycastVoxel(self, origin, dir, maxDist = 8) {
    const pos = origin.clone().addScaledVector(dir, 0.001);
    const stepX = Math.sign(dir.x) || 0, stepY = Math.sign(dir.y) || 0, stepZ = Math.sign(dir.z) || 0;
    let t = 0;
    const voxel = new THREE.Vector3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
    const tDelta = new THREE.Vector3(Math.abs(1 / (dir.x || 1e-9)), Math.abs(1 / (dir.y || 1e-9)), Math.abs(1 / (dir.z || 1e-9)));
    const nextVoxelBoundary = new THREE.Vector3(
        stepX > 0 ? (voxel.x + 1 - pos.x) : (pos.x - voxel.x),
        stepY > 0 ? (voxel.y + 1 - pos.y) : (pos.y - voxel.y),
        stepZ > 0 ? (voxel.z + 1 - pos.z) : (pos.z - voxel.z)
    );
    const tMax = new THREE.Vector3(nextVoxelBoundary.x * tDelta.x, nextVoxelBoundary.y * tDelta.y, nextVoxelBoundary.z * tDelta.z);
    const maxT = Math.max(0, maxDist);
    let lastStep = { x: 0, y: 0, z: 0 };
    while (t <= maxT) {
        const vx = Math.floor(voxel.x), vy = Math.floor(voxel.y), vz = Math.floor(voxel.z);
        const vt = self.voxelEngine.getVoxelTypeWorld(vx, vy, vz);
        if (vt) {
            let hit = true;
            if (self.voxelEngine.blockTypes?.cactusBlockIds?.has(vt)) {
                const inset = 1/16;
                const min = new THREE.Vector3(vx + inset, vy, vz + inset);
                const max = new THREE.Vector3(vx + 1 - inset, vy + 1, vz + 1 - inset);
                const inv = new THREE.Vector3(1 / (dir.x || 1e-9), 1 / (dir.y || 1e-9), 1 / (dir.z || 1e-9));
                let tmin = ( (dir.x >= 0 ? min.x : max.x) - origin.x) * inv.x;
                let tmax = ( (dir.x >= 0 ? max.x : min.x) - origin.x) * inv.x;
                const tymin = ( (dir.y >= 0 ? min.y : max.y) - origin.y) * inv.y;
                const tymax = ( (dir.y >= 0 ? max.y : min.y) - origin.y) * inv.y;
                if (tmin > tymax || tymin > tmax) hit = false;
                else { tmin = Math.max(tmin, tymin); tmax = Math.min(tmax, tymax); }
                const tzmin = ( (dir.z >= 0 ? min.z : max.z) - origin.z) * inv.z;
                const tzmax = ( (dir.z >= 0 ? max.z : min.z) - origin.z) * inv.z;
                if (tmin > tzmax || tzmin > tmax) hit = false;
                else { tmin = Math.max(tmin, tzmin); tmax = Math.min(tmax, tzmax); }
                if (!(tmax >= Math.max(0, tmin) && tmin <= maxDist)) hit = false;
            }
            if (hit) {
                if (lastStep.x === 0 && lastStep.y === 0 && lastStep.z === 0) {
                    const nx = Math.sign(dir.x) ? -Math.sign(dir.x) : 0;
                    const ny = Math.sign(dir.y) ? -Math.sign(dir.y) : 0;
                    const nz = Math.sign(dir.z) ? -Math.sign(dir.z) : 0;
                    return { x: vx, y: vy, z: vz, nx, ny, nz };
                }
                return { x: vx, y: vy, z: vz, nx: -lastStep.x, ny: -lastStep.y, nz: -lastStep.z };
            }
            // else: treat as miss (continue stepping)
        }
        if (tMax.x < tMax.y) {
            if (tMax.x < tMax.z) { voxel.x += stepX; t = tMax.x; tMax.x += tDelta.x; lastStep = { x: stepX, y: 0, z: 0 }; }
            else { voxel.z += stepZ; t = tMax.z; tMax.z += tDelta.z; lastStep = { x: 0, y: 0, z: stepZ }; }
        } else {
            if (tMax.y < tMax.z) { voxel.y += stepY; t = tMax.y; tMax.y += tDelta.y; lastStep = { x: 0, y: stepY, z: 0 }; }
            else { voxel.z += stepZ; t = tMax.z; tMax.z += tDelta.z; lastStep = { x: 0, y: 0, z: stepZ }; }
        }
    }
    return null;
}

/* exported function installBlockInteractions */
export function installBlockInteractions(self) {
    const canvas = self.canvas;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const doRaycast = (maxDist = 8) => raycastVoxel(self, self.camera.position, self.camera.getWorldDirection(new THREE.Vector3()), maxDist);
    // Simple cached atlas loader for drawing item icons into slots
    let atlasImgPromise;
    const getAtlas = () => {
        if (atlasImgPromise) return atlasImgPromise;
        atlasImgPromise = new Promise((resolve, reject) => {
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img); img.onerror = reject; img.src = 'terrain.png';
        });
        return atlasImgPromise;
    };
    const drawTile = async (canvas, u, v) => {
        try {
            const img = await getAtlas();
            const tile = 16, tilesPerRow = Math.floor(img.width / tile) || 16;
            const sx = (u % tilesPerRow) * tile, sy = (v|0) * tile;
            const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0,0,canvas.width,canvas.height);
            ctx.drawImage(img, sx, sy, tile, tile, 0, 0, canvas.width, canvas.height);
        } catch {}
    };
    const addBlockToInventory = async (blockId) => {
        const inv = document.getElementById('inventoryGrid');
        const hotbar = document.getElementById('hotbar');
        if (!inv || !hotbar) return;
        const MAX_STACK = 64;
        const isEmpty = (s) => !(Number(s?.dataset?.id) > 0);
        const getCount = (s) => Number(s?.dataset?.count || 0);
        const setCount = (s, c) => {
            s.dataset.count = String(c);
            let badge = s.querySelector('.count');
            if (!badge) { badge = document.createElement('span'); badge.className = 'count'; s.appendChild(badge); }
            badge.textContent = c > 1 ? String(c) : '';
        };
        const findStack = (container) => Array.from(container.querySelectorAll('.slot')).find(s => Number(s.dataset.id) === blockId && getCount(s) < MAX_STACK);
        const findEmpty = (container) => Array.from(container.querySelectorAll('.slot')).find(isEmpty);

        // 1) Try to stack in hotbar, then inventory
        let slot = findStack(hotbar) || findStack(inv);
        if (slot) {
            setCount(slot, Math.min(MAX_STACK, getCount(slot) + 1));
            try { self.uiManager?.hotbar?.saveInventory?.(); } catch {}
            return;
        }

        // 2) Find empty slot (prefer selected hotbar slot if empty)
        const selectedIdx = (window.currentApp?.uiManager?.hotbar?.hotbarUI?.selectedHotbarIndex) ?? 0;
        const selectedSlot = hotbar.children?.[selectedIdx];
        slot = (selectedSlot && isEmpty(selectedSlot)) ? selectedSlot : (findEmpty(hotbar) || findEmpty(inv));
        if (!slot) return;

        const u = Math.max(0, (blockId|0) - 1), v = 0;
        slot.dataset.id = String(blockId); slot.dataset.u = String(u); slot.dataset.v = String(v);
        setCount(slot, 1);
        const canvasEl = slot.querySelector('canvas') || (() => { const c=document.createElement('canvas'); c.width=64; c.height=64; slot.appendChild(c); return c; })();
        await drawTile(canvasEl, u, v);
        // make interactive even in survival mode (click to select, draggable for later)
        slot.setAttribute('draggable','true');
        if (!slot._clickBound) {
            slot.addEventListener('click', () => {
                if (slot.parentElement === hotbar) {
                    const idx = Array.from(hotbar.children).indexOf(slot);
                    if (idx >= 0) self.uiManager?.hotbar?.selectHotbarIndex?.(idx);
                } else {
                    const idNum = Number(slot.dataset.id) || 0;
                    const uu = Number(slot.dataset.u) || 0;
                    const vv = Number(slot.dataset.v) || 0;
                    window.dispatchEvent(new CustomEvent('hotbar-select', { detail: { u: uu, v: vv, id: idNum, index: -1 } }));
                }
            });
            slot._clickBound = true;
        }
        try { self.uiManager?.hotbar?.saveInventory?.(); } catch {}
        // if placed into hotbar, select it
        if (slot.parentElement === hotbar) {
            const idx = Array.from(hotbar.children).indexOf(slot);
            if (idx >= 0) self.uiManager?.hotbar?.selectHotbarIndex?.(idx);
        }
    };
    canvas.addEventListener('mousedown', (e) => {
        // Ignore this click if it's the one acquiring pointer lock
        if (document.pointerLockElement !== canvas) return;
        if (e.button === 0) {
            const hit = doRaycast();
            if (hit) {
                // If survival mode, add mined block to inventory before removing it
                if (!self.isCreative) {
                    const t = self.voxelEngine.getVoxelTypeWorld(hit.x, hit.y, hit.z) | 0;
                    if (t > 0) { addBlockToInventory(t); }
                }
                self.voxelEngine.setVoxelWorld(hit.x, hit.y, hit.z, 0);
            }
        } else if (e.button === 2) {
            const hit = doRaycast();
            if (hit) {
                const placeX = hit.x + (hit.nx || 0), placeY = hit.y + (hit.ny || 0), placeZ = hit.z + (hit.nz || 0);
                const typeToPlace = Number(self.selectedBlockId) || 0;
                if (typeToPlace <= 0) return; // no valid block selected; do nothing
                // Prevent placing a block that would intersect the player's collision box
                const camPos = self.camera.position;
                const r = self.player?.radius || 0.3;
                const h = self.player?.height || 1.8;
                const eye = self.player?.eyeHeight || 1.6;
                const playerMin = { x: camPos.x - r, y: camPos.y - eye, z: camPos.z - r };
                const playerMax = { x: camPos.x + r, y: camPos.y - eye + h, z: camPos.z + r };
                const blockMin = { x: placeX, y: placeY, z: placeZ };
                const blockMax = { x: placeX + 1, y: placeY + 1, z: placeZ + 1 };
                const overlap = (playerMin.x < blockMax.x && playerMax.x > blockMin.x) &&
                                (playerMin.y < blockMax.y && playerMax.y > blockMin.y) &&
                                (playerMin.z < blockMax.z && playerMax.z > blockMin.z);
                // Allow placement if there's no overlap OR the block being placed is non-solid (e.g. plant)
                const isNonSolid = !!(self.voxelEngine?.blockTypes?.isNonSolid && self.voxelEngine.blockTypes.isNonSolid(typeToPlace));
                if (!overlap || isNonSolid) self.voxelEngine.setVoxelWorld(placeX, placeY, placeZ, typeToPlace);
                // decrement held stack in survival mode
                if (!self.isCreative && (!overlap || isNonSolid)) {
                    const hotbar = document.getElementById('hotbar');
                    const idx = self.uiManager?.hotbar?.hotbarUI?.selectedHotbarIndex ?? 0;
                    const slot = hotbar?.children?.[idx];
                    if (slot && Number(slot.dataset.id) === typeToPlace) {
                        let c = Number(slot.dataset.count || 0) - 1;
                        if (c <= 0) {
                            delete slot.dataset.id; delete slot.dataset.u; delete slot.dataset.v; slot.dataset.count = '0';
                            const cEl = slot.querySelector('.count'); if (cEl) cEl.textContent = '';
                            const cv = slot.querySelector('canvas'); if (cv) { const ctx=cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); }
                        } else {
                            slot.dataset.count = String(c);
                            let badge = slot.querySelector('.count'); if (!badge) { badge=document.createElement('span'); badge.className='count'; slot.appendChild(badge); }
                            badge.textContent = c > 1 ? String(c) : '';
                        }
                        try { self.uiManager?.hotbar?.saveInventory?.(); self.uiManager?.hotbar?.selectHotbarIndex?.(idx); } catch {}
                    }
                }
            }
        }
    });
}