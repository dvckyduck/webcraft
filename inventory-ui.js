import * as THREE from 'three';

export class InventoryUI {
  constructor(hotbarUI) {
    this.hotbarUI = hotbarUI;
    this.inventoryGrid = document.getElementById('inventoryGrid');
    this.hotbarEl = document.getElementById('hotbar');
    this.inventoryOverlay = document.getElementById('inventoryOverlay');
    this._persistKey = 'voxel_inventory_v1';
    this._atlasImg = null;
  }

  initialize(hotbarEl, inventoryGrid, persistKey) {
    this.hotbarEl = hotbarEl || this.hotbarEl;
    this.inventoryGrid = inventoryGrid || this.inventoryGrid;
    if (persistKey) this._persistKey = persistKey;
    this.setupBasicSlots();
    this.loadAtlasAndRenderIcons();
    this.bindDragDrop();
    this.attachInteractionsToAllSlots();
    window.addEventListener('mouseup', () => this.hotbarUI.saveInventory());
  }

  setPersistKey(k) { if (k) this._persistKey = k; }
  _getAtlas() {
    if (this._atlasImg) return Promise.resolve(this._atlasImg);
    return new Promise((res, rej) => { const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { this._atlasImg = img; res(img); }; img.onerror = rej; img.src = 'terrain.png'; });
  }

  setupBasicSlots() {
    if (this.inventoryGrid && this.inventoryGrid.children.length === 0) {
      for (let i = 0; i < 27; i++) {
        const slot = document.createElement('div'); slot.className = 'slot';
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; slot.appendChild(canvas);
        this.inventoryGrid.appendChild(slot);
      }
    }
  }

  toggleInventory(force) {
    const open = force !== undefined ? force : !this.inventoryOverlay.classList.contains('open');
    this.inventoryOverlay.classList.toggle('open', open);
    this.inventoryOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (open) {
      try {
        const p = document.exitPointerLock?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (_) {}
    }
  }

  bindDragDrop() {
    const allowDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
    const handleDrop = async (e) => {
      e.preventDefault();
      const dragged = document.querySelector('.slot.dragging');
      const targetSlot = e.target.closest('.slot');
      if (!dragged || !targetSlot || dragged === targetSlot) return;
      const da = { u: dragged.dataset.u, v: dragged.dataset.v, id: dragged.dataset.id, count: dragged.dataset.count };
      const db = { u: targetSlot.dataset.u, v: targetSlot.dataset.v, id: targetSlot.dataset.id, count: targetSlot.dataset.count };
      Object.assign(dragged.dataset, db); Object.assign(targetSlot.dataset, da);
      const img = await this._getAtlas(); const tile = 16, cols = Math.floor(img.width / tile) || 16;
      const redraw = (slot) => { const u = Number(slot.dataset.u), v = Number(slot.dataset.v) || 0;
        const c = slot.querySelector('canvas'); if (!c) return; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0,0,c.width,c.height); if (Number.isFinite(u)) { const sx = (u % cols) * tile, sy = (v|0) * tile; ctx.drawImage(img,sx,sy,tile,tile,0,0,c.width,c.height); } };
      const setBadge = (slot) => { let b = slot.querySelector('.count'); if (!b) { b = document.createElement('span'); b.className='count'; slot.appendChild(b); }
        const n = Number(slot.dataset.count)||0; b.textContent = n > 1 ? String(n) : ''; };
      redraw(dragged); redraw(targetSlot); setBadge(dragged); setBadge(targetSlot);
      dragged.classList.remove('dragging'); this.hotbarUI.saveInventory(); this.hotbarUI.selectHotbarIndex(this.hotbarUI.selectedHotbarIndex);
    };
    this.hotbarEl?.addEventListener('dragover', allowDragOver);
    this.hotbarEl?.addEventListener('drop', handleDrop);
    this.inventoryGrid?.addEventListener('dragover', allowDragOver);
    this.inventoryGrid?.addEventListener('drop', handleDrop);
  }

  attachInteractionsToAllSlots() {
    const all = [...(this.hotbarEl?.querySelectorAll('.slot') || []), ...(this.inventoryGrid?.querySelectorAll('.slot') || [])];
    all.forEach(slot => {
      this.ensureSlotInteractive(slot);
      // ensure count badge reflects dataset.count
      if (!slot.querySelector('.count')) {
        const badge = document.createElement('span'); badge.className = 'count'; slot.appendChild(badge);
      }
      const badge = slot.querySelector('.count');
      const c = Number(slot.dataset.count || 0);
      badge.textContent = c > 1 ? String(c) : '';
    });
  }

  ensureSlotInteractive(slot) {
    if (!slot || slot._dragBound) return;
    slot.setAttribute('draggable','true');
    slot.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        u: slot.dataset.u || '', v: slot.dataset.v || '', id: slot.dataset.id || '', from: slot.parentElement?.id || ''
      }));
      slot.classList.add('dragging');
    });
    slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
    slot._dragBound = true;
  }

  loadAtlasAndRenderIcons() {
    // Use the new preferred atlas file
    const atlasSrc = 'terrain.png';
    // In survival mode, start with empty inventory/hotbar and do not auto-populate
    if (window.__gamemode === 'survival') {
      this.attachInteractionsToAllSlots();
      return; 
    }
    const atlasImg = new Image();
    atlasImg.crossOrigin = 'anonymous';
    atlasImg.onload = () => {
      const tilesPerRow = Math.floor(atlasImg.width / 16) || 16;
      const rows = Math.floor(atlasImg.height / 16) || 1;
      const tileW = atlasImg.width / tilesPerRow, tileH = atlasImg.height / rows;
      const sharedTexture = new THREE.CanvasTexture(atlasImg);
      sharedTexture.magFilter = THREE.NearestFilter;
      sharedTexture.minFilter = THREE.NearestFilter;
      sharedTexture.generateMipmaps = false;
      sharedTexture.flipY = false;
      sharedTexture.needsUpdate = true;

      // draw a single tile from the atlas onto a target canvas (2D blit)
      const drawTileToCanvas = (uCol, vRow, canvas) => {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        const sx = uCol * tileW, sy = vRow * tileH;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(atlasImg, sx, sy, tileW, tileH, 0, 0, canvas.width, canvas.height);
      };

      // render hotbar canvases
      for (const slot of Array.from(this.hotbarEl?.querySelectorAll('.slot') || [])) {
        // only render if the slot has a valid tile assigned
        if (slot.dataset.u == null || slot.dataset.u === '') continue;
        const u = Number(slot.dataset.u), v = Number(slot.dataset.v) || 0;
        // default dataset.id to column-based id (u + 1) if missing
        if (!slot.dataset.id) slot.dataset.id = String(u + 1);
        const canvas = slot.querySelector('canvas');
        if (canvas) drawTileToCanvas(u, v, canvas);
        // ensure count badge exists and is hidden for 1
        slot.dataset.count = slot.dataset.count || (slot.dataset.id ? '1' : '0');
        if (!slot.querySelector('.count')) {
          const badge = document.createElement('span'); badge.className = 'count'; slot.appendChild(badge);
        }
        const badge = slot.querySelector('.count'); badge.textContent = Number(slot.dataset.count) > 1 ? slot.dataset.count : '';
      }

      // fill remaining columns into inventory grid if empty
      const tilesToPopulate = tilesPerRow;
      let placed = 0;
      for (let u = 0; u < tilesToPopulate; u++) {
        const already = Array.from(this.hotbarEl?.children || []).some(s => s.dataset.u !== undefined && Number(s.dataset.u) === u);
        if (already) continue;
        // prefer filling existing empty hotbar slots first, then inventory empty slots, then append to inventory
        const emptyHotbarSlot = Array.from(this.hotbarEl?.children || []).find(s => !s.dataset.u);
        const existingEmptySlot = Array.from(this.inventoryGrid?.children || []).find(s => !s.dataset.u);
        if (emptyHotbarSlot) {
          emptyHotbarSlot.dataset.u = u; emptyHotbarSlot.dataset.v = 0;
          emptyHotbarSlot.dataset.id = String(u + 1);
          emptyHotbarSlot.dataset.count = '1';
          const canvas = emptyHotbarSlot.querySelector('canvas') || (() => { const c=document.createElement('canvas'); c.width=64; c.height=64; emptyHotbarSlot.appendChild(c); return c; })();
          drawTileToCanvas(u, 0, canvas);
          if (!emptyHotbarSlot.querySelector('.count')) { const b=document.createElement('span'); b.className='count'; emptyHotbarSlot.appendChild(b); }
          const b = emptyHotbarSlot.querySelector('.count'); b.textContent = '';
        } else if (existingEmptySlot) {
          existingEmptySlot.dataset.u = u; existingEmptySlot.dataset.v = 0;
          existingEmptySlot.dataset.id = String(u + 1);
          existingEmptySlot.dataset.count = '1';
          const canvas = existingEmptySlot.querySelector('canvas') || (() => { const c=document.createElement('canvas'); c.width=64; c.height=64; existingEmptySlot.appendChild(c); return c; })();
          drawTileToCanvas(u, 0, canvas);
          if (!existingEmptySlot.querySelector('.count')) { const b=document.createElement('span'); b.className='count'; existingEmptySlot.appendChild(b); }
          const b = existingEmptySlot.querySelector('.count'); b.textContent = '';
        } else {
          const slot = document.createElement('div'); slot.className = 'slot'; slot.dataset.u = u; slot.dataset.v = 0;
          slot.dataset.id = String(u + 1);
          slot.dataset.count = '1';
          const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; slot.appendChild(canvas);
          const badge = document.createElement('span'); badge.className = 'count'; slot.appendChild(badge);
          this.inventoryGrid?.appendChild(slot);
          drawTileToCanvas(u, 0, canvas);
        }
        placed++;
      }
    };
    atlasImg.src = atlasSrc;
  }
}