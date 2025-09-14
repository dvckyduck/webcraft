// New module extracted from main.js to keep the entry file small.
// Contains world list UI, world create/open logic, and pause/options handlers.

import { VoxelRenderer } from './app.js';

export function initMenu() {
  const menu = document.getElementById('mainMenu');
  const singleBtn = document.getElementById('singleBtn');
  const optionsBtnMenu = document.getElementById('optionsBtnMenu');

  // World opener elements
  const worldOpener = document.getElementById('worldOpener');
  const worldListEl = document.getElementById('worldList');
  const newWorldNameInput = document.getElementById('newWorldName');
  const createWorldBtn = document.getElementById('createWorldBtn');
  const cancelWorldBtn = document.getElementById('cancelWorldBtn');
  const openCreateWorldBtn = document.getElementById('openCreateWorldBtn');
  const createWorldModal = document.getElementById('createWorldModal');
  const cancelCreateWorldBtn = document.getElementById('cancelCreateWorldBtn');
  let optionsOpenedByMenu = false;

  const WORLD_INDEX_KEY = 'voxel_world_index_v1';
  const WORLD_META_KEY = 'voxel_world_meta_v1';

  const loadWorldIndex = () => {
    try { return JSON.parse(localStorage.getItem(WORLD_INDEX_KEY) || '[]'); } catch { return []; }
  };
  const saveWorldIndex = (arr) => { localStorage.setItem(WORLD_INDEX_KEY, JSON.stringify(arr)); };

  const loadWorldMeta = () => { try { return JSON.parse(localStorage.getItem(WORLD_META_KEY) || '{}'); } catch { return {}; } };
  const saveWorldMeta = (meta) => { localStorage.setItem(WORLD_META_KEY, JSON.stringify(meta)); };

  const refreshWorldList = () => {
    const idx = loadWorldIndex();
    const meta = loadWorldMeta();
    worldListEl.innerHTML = '';
    if (idx.length === 0) {
      const p = document.createElement('div'); p.className = 'world-item'; p.textContent = 'No worlds yet — create one below.'; worldListEl.appendChild(p);
      return;
    }
    idx.forEach((name) => {
      const item = document.createElement('div'); item.className = 'world-item';
      const metaDiv = document.createElement('div'); metaDiv.className = 'meta';
      const title = document.createElement('div'); title.textContent = name;
      const typeBadge = document.createElement('div'); typeBadge.textContent = (meta[name]?.type || 'normal'); typeBadge.style.opacity = '0.9'; typeBadge.style.fontSize='12px'; typeBadge.style.color='#ccc';
      metaDiv.appendChild(title);
      metaDiv.appendChild(typeBadge);
      const controls = document.createElement('div');
      const openBtn = document.createElement('button'); openBtn.className = 'btn'; openBtn.textContent = 'Open';
      const delBtn = document.createElement('button'); delBtn.className = 'btn'; delBtn.textContent = 'Delete';
      openBtn.addEventListener('click', () => openWorld(name));
      delBtn.addEventListener('click', () => {
        if (!confirm(`Delete world "${name}"? This removes its saved data.`)) return;
        const next = loadWorldIndex().filter(n => n !== name);
        saveWorldIndex(next);
        try { localStorage.removeItem(`voxel_world:${name}`); } catch (e) {}
        refreshWorldList();
      });
      controls.appendChild(openBtn); controls.appendChild(delBtn);
      item.appendChild(metaDiv); item.appendChild(controls);
      worldListEl.appendChild(item);
    });
  };

  const openWorld = async (name) => {
    worldOpener.classList.remove('open'); worldOpener.setAttribute('aria-hidden','true');
    menu?.classList.add('hidden');
    try {
      const persistKey = `voxel_world:${name}`;
      const meta = loadWorldMeta();
      const gamemode = (meta[name]?.gamemode) || 'survival';
      // Expose gamemode globally so UI/inventory logic can adapt
      window.__gamemode = gamemode;
      const app = new VoxelRenderer({ persistKey, gamemode });
      window.currentApp = app;
      await app.init();
      app.animate();
      try {
        app.canvas?.focus?.();
        const p = app.canvas?.requestPointerLock?.();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
      setTimeout(() => {
        if (document.pointerLockElement !== app.canvas) {
          const hintId = 'pointerHint';
          if (!document.getElementById(hintId)) {
            const hint = document.createElement('div');
            hint.id = hintId;
            hint.textContent = 'Click the canvas to enable mouse control';
            hint.style.position = 'fixed';
            hint.style.left = '50%';
            hint.style.bottom = '20px';
            hint.style.transform = 'translateX(-50%)';
            hint.style.background = 'rgba(0,0,0,0.7)';
            hint.style.color = '#fff';
            hint.style.padding = '8px 12px';
            hint.style.borderRadius = '6px';
            hint.style.zIndex = 9999;
            document.body.appendChild(hint);
            setTimeout(() => hint.remove(), 4500);
          }
        }
      }, 200);
    } catch (err) { console.error('Initialization failed:', err); }
  };

  createWorldBtn?.addEventListener('click', () => {
    const name = (newWorldNameInput.value || '').trim();
    const type = (document.getElementById('newWorldType')?.value) || 'normal';
    const gamemode = (document.getElementById('newWorldGamemode')?.value) || 'survival';
    if (!name) { alert('Enter a world name'); return; }
    const idx = loadWorldIndex();
    if (idx.includes(name)) { alert('A world with that name already exists'); return; }
    idx.push(name); saveWorldIndex(idx);
    try { localStorage.setItem(`voxel_world:${name}`, JSON.stringify({})); } catch (e) {}
    const meta = loadWorldMeta(); meta[name] = { type, gamemode }; saveWorldMeta(meta);
    newWorldNameInput.value = '';
    createWorldModal?.classList.remove('open'); createWorldModal?.setAttribute('aria-hidden','true');
    refreshWorldList();
    openWorld(name);
  });
  cancelWorldBtn?.addEventListener('click', () => {
    worldOpener.classList.remove('open'); worldOpener.setAttribute('aria-hidden','true');
  });
  openCreateWorldBtn?.addEventListener('click', () => {
    createWorldModal?.classList.add('open'); createWorldModal?.setAttribute('aria-hidden','false');
    setTimeout(() => newWorldNameInput?.focus(), 10);
  });
  cancelCreateWorldBtn?.addEventListener('click', () => {
    createWorldModal?.classList.remove('open'); createWorldModal?.setAttribute('aria-hidden','true');
  });

  singleBtn?.addEventListener('click', async () => {
    worldOpener.classList.add('open'); worldOpener.setAttribute('aria-hidden','false');
    refreshWorldList();
  });

  optionsBtnMenu?.addEventListener('click', () => {
    const overlay = document.getElementById('optionsOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelectorAll('.coord-inputs').forEach(el => el.style.display = 'none');
    menu?.classList.add('hidden');
    optionsOpenedByMenu = true;
    const focusTarget = overlay.querySelector('.options-content button, .options-content input, .options-content [role="button"]');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  });

  const closeOptionsBtn = document.getElementById('closeOptions');
  closeOptionsBtn?.addEventListener('click', () => {
    const overlay = document.getElementById('optionsOverlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.querySelectorAll('.coord-inputs').forEach(el => el.style.display = '');
    if (optionsOpenedByMenu) {
      menu?.classList.remove('hidden');
      optionsOpenedByMenu = false;
    }
  });

  // Blocks browser handling
  const blocksOverlay = document.getElementById('blocksOverlay');
  const blocksGrid = document.getElementById('blocksGrid');
  const openBlocksBtn = document.getElementById('openBlocksBtn');
  const closeBlocksBtn = document.getElementById('closeBlocksBtn');
  let blocksPopulated = false;
  const populateBlocks = async () => {
    if (blocksPopulated) return;
    const atlasSrc = 'terrain.png';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tile = 16;
      const tilesPerRow = Math.floor(img.width / tile) || 16;
      const rows = Math.floor(img.height / tile) || 1;
      for (let u = 0; u < tilesPerRow; u++) {
        const id = u + 1;
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = tile; tileCanvas.height = tile;
        const ctx = tileCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, u * tile, 0, tile, tile, 0, 0, tile, tile);

        const tileWrap = document.createElement('div');
        tileWrap.className = 'block-tile';
        const preview = document.createElement('canvas');
        preview.width = 48; preview.height = 48;
        const pctx = preview.getContext('2d');
        pctx.imageSmoothingEnabled = false;
        pctx.drawImage(tileCanvas, 0, 0, preview.width, preview.height);
        const label = document.createElement('div'); label.className = 'block-id'; label.textContent = `id: ${id}`;
        tileWrap.appendChild(preview); tileWrap.appendChild(label);
        blocksGrid.appendChild(tileWrap);
      }

      blocksPopulated = true;
    };
    img.onerror = () => { const p = document.createElement('div'); p.textContent = 'Failed to load atlas'; p.style.color='red'; blocksGrid.appendChild(p); };
    img.src = atlasSrc;
  };
  openBlocksBtn?.addEventListener('click', () => {
    const overlay = document.getElementById('optionsOverlay');
    overlay?.classList.remove('open');
    overlay?.setAttribute('aria-hidden','true');
    blocksOverlay?.classList.add('open'); blocksOverlay?.setAttribute('aria-hidden','false');
    populateBlocks();
  });
  closeBlocksBtn?.addEventListener('click', () => {
    blocksOverlay?.classList.remove('open'); blocksOverlay?.setAttribute('aria-hidden','true');
    const overlay = document.getElementById('optionsOverlay');
    if (overlay) {
      overlay.classList.add('open');
      overlay.setAttribute('aria-hidden', 'false');
      overlay.querySelectorAll('.coord-inputs').forEach(el => el.style.display = '');
      const focusTarget = overlay.querySelector('.options-content button, .options-content input, .options-content [role="button"]');
      if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    }
  });

  // Double-click fallback
  menu?.querySelector('#singleBtn')?.addEventListener('dblclick', async () => {
    menu?.classList.add('hidden');
    try { const app = new VoxelRenderer(); await app.init(); app.animate(); }
    catch (err) { console.error('Initialization failed:', err); }
  });
  menu?.querySelector('#singleBtn')?.addEventListener('dblclick', async () => {
    try { window.currentApp = window.currentApp || null; } catch(e) {}
  });

  newWorldNameInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') createWorldBtn.click(); });

  // Pause menu handling (open with Escape when in-game)
  const pauseOverlay = document.getElementById('pauseOverlay');
  const resumeBtn = document.getElementById('resumeBtn');
  const pauseOptionsBtn = document.getElementById('pauseOptionsBtn');
  const returnMainMenuBtn = document.getElementById('returnMainMenuBtn');

  const showPause = () => {
    if (!pauseOverlay) return;
    pauseOverlay.classList.add('open');
    pauseOverlay.setAttribute('aria-hidden', 'false');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  };
  const hidePause = () => {
    if (!pauseOverlay) return;
    pauseOverlay.classList.remove('open');
    pauseOverlay.setAttribute('aria-hidden', 'true');
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === '`') {
      e.preventDefault();
      showPause();
      return;
    }
    if (e.key !== 'Escape') return;
    if (!menu?.classList.contains('hidden')) return;
    const app = window.currentApp;
    if (app && typeof app.pause === 'function' && typeof app.resume === 'function') {
      e.preventDefault();
      if (app.paused) app.resume(); else app.pause();
    } else {
      const pauseOverlay = document.getElementById('pauseOverlay');
      if (!pauseOverlay) return;
      const isOpen = pauseOverlay.classList.contains('open');
      if (isOpen) {
        pauseOverlay.classList.remove('open'); pauseOverlay.setAttribute('aria-hidden', 'true');
      } else {
        pauseOverlay.classList.add('open'); pauseOverlay.setAttribute('aria-hidden', 'false');
        try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
      }
    }
  }, true);

  resumeBtn?.addEventListener('click', () => {
    hidePause();
  });

  pauseOptionsBtn?.addEventListener('click', () => {
    const overlay = document.getElementById('optionsOverlay');
    if (!overlay) return;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelectorAll('.coord-inputs').forEach(el => el.style.display = '');
    hidePause();
    optionsOpenedByMenu = false;
  });

  returnMainMenuBtn?.addEventListener('click', () => {
    hidePause();
    const overlay = document.getElementById('optionsOverlay');
    if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true'); }
    menu?.classList.remove('hidden');
    location.reload();
  });
}