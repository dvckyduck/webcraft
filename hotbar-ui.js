import * as THREE from 'three';

export class HotbarUI {
  constructor() {
    this.hotbarEl = document.getElementById('hotbar');
    this.selectedHotbarIndex = 0;
    this._persistKey = 'voxel_inventory_v1';
    this._atlasImg = null; // cache atlas for drawing icons
  }

  initialize(hotbarEl, inventoryGrid, persistKey) {
    this.hotbarEl = hotbarEl || this.hotbarEl;
    this.inventoryGrid = inventoryGrid;
    if (persistKey) this._persistKey = persistKey;
    // Build initial slots (kept small; heavy rendering happens when atlas loads in inventory UI)
    if (this.hotbarEl && this.hotbarEl.children.length === 0) {
      for (let i = 0; i < 9; i++) {
        const slot = document.createElement('div'); slot.className = 'slot';
        const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; slot.appendChild(canvas);
        this.hotbarEl.appendChild(slot);
      }
    }
    this.updateHotbarSelection();
  }

  bindGlobalShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE') { e.preventDefault(); window.dispatchEvent(new KeyboardEvent('KeyE')); return; }
      const match = e.code.match(/(?:Digit|Numpad)([1-9])/);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        this.selectHotbarIndex(idx);
      }
    });

    window.addEventListener('wheel', (e) => {
      if (document.getElementById('inventoryOverlay')?.classList.contains('open')) return;
      if (e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const hotbar = this.hotbarEl;
      if (!hotbar) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY);
      if (delta > 0) this.selectHotbarIndex(this.selectedHotbarIndex + 1);
      else if (delta < 0) this.selectHotbarIndex(this.selectedHotbarIndex - 1);
    }, { passive: false });
  }

  selectHotbarIndex(index) {
    if (!this.hotbarEl) return;
    const count = this.hotbarEl.children.length;
    if (count === 0) return;
    let idx = ((index % count) + count) % count;
    this.selectedHotbarIndex = idx;
    this.updateHotbarSelection();
    const slot = this.hotbarEl.children[idx];
    const uRaw = Number(slot?.dataset.u), vRaw = Number(slot?.dataset.v);
    const u = Number.isFinite(uRaw) ? uRaw : undefined;
    const v = Number.isFinite(vRaw) ? vRaw : undefined;
    let id = Number(slot?.dataset.id);
    // If no explicit id stored on the slot, treat as empty (0).
    if (!Number.isFinite(id) || isNaN(id)) {
      id = 0;
    }
    const numericId = Number(id);
    window.dispatchEvent(new CustomEvent('hotbar-select', { detail: { u, v, id: numericId, index: idx } }));
    this.saveInventory();
  }

  updateHotbarSelection() {
    if (!this.hotbarEl) return;
    const slots = Array.from(this.hotbarEl.querySelectorAll('.slot'));
    slots.forEach((s, i) => s.classList.toggle('selected', i === this.selectedHotbarIndex));
  }

  _renderHotbarIcons() {
    const ensureAtlas = () => this._atlasImg ? Promise.resolve(this._atlasImg) : new Promise((res, rej) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { this._atlasImg = img; res(img); }; img.onerror = rej; img.src = 'terrain.png';
    });
    ensureAtlas().then((img) => {
      const tile = 16, cols = Math.floor(img.width / tile) || 16;
      Array.from(this.hotbarEl?.querySelectorAll('.slot') || []).forEach(slot => {
        const u = Number(slot.dataset.u), v = Number(slot.dataset.v) || 0;
        if (!Number.isFinite(u)) return;
        const sx = (u % cols) * tile, sy = (v|0) * tile;
        const c = slot.querySelector('canvas'); if (!c) return;
        const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0,0,c.width,c.height); ctx.drawImage(img, sx, sy, tile, tile, 0, 0, c.width, c.height);
      });
    }).catch(() => {});
  }

  // persistence helpers
  setPersistKey(key) { if (key) this._persistKey = key; }
  saveInventory() {
    try {
      const hotbarSlots = Array.from(this.hotbarEl?.querySelectorAll('.slot') || []).map(s => ({ u: s.dataset.u, v: s.dataset.v, id: s.dataset.id, count: s.dataset.count }));
      const invSlots = Array.from(this.inventoryGrid?.querySelectorAll('.slot') || []).map(s => ({ u: s.dataset.u, v: s.dataset.v, id: s.dataset.id, count: s.dataset.count }));
      const payload = { hotbar: hotbarSlots, inventory: invSlots, selectedIndex: this.selectedHotbarIndex };
      localStorage.setItem(this._persistKey, JSON.stringify(payload));
    } catch (e) { console.warn('Failed to save inventory', e); }
  }

  loadInventory() {
    try {
      const raw = localStorage.getItem(this._persistKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed) return;
      if (parsed.hotbar && this.hotbarEl) {
        this.hotbarEl.innerHTML = '';
        parsed.hotbar.forEach(s => {
          const slot = document.createElement('div'); slot.className = 'slot';
          const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64; slot.appendChild(canvas);
          slot.dataset.u = s.u; slot.dataset.v = s.v; slot.dataset.id = s.id; slot.dataset.count = s.count || (s.id ? 1 : 0);
          // badge
          if (!slot.querySelector('.count')) {
            const badge = document.createElement('span'); badge.className = 'count'; slot.appendChild(badge);
          }
          const badge = slot.querySelector('.count'); if (badge) badge.textContent = slot.dataset.count && Number(slot.dataset.count) > 1 ? String(slot.dataset.count) : '';
          this.hotbarEl.appendChild(slot);
        });
        this._renderHotbarIcons(); // draw textures for loaded stacks
      }
      if (typeof parsed.selectedIndex === 'number') this.selectedHotbarIndex = parsed.selectedIndex;
      this.updateHotbarSelection();
      this.selectHotbarIndex(this.selectedHotbarIndex);
    } catch (e) { console.warn('Failed to load inventory', e); }
  }
}