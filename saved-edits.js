export class SavedEditsStore {
  constructor(persistKey) {
    this._persistKey = persistKey || 'voxel_saved_edits_v1';
    this.data = {};
    this._timer = null;
    this.load();
  }

  load() {
    try { this.data = JSON.parse(localStorage.getItem(this._persistKey) || '{}') || {}; } catch { this.data = {}; }
  }

  persist() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try { localStorage.setItem(this._persistKey, JSON.stringify(this.data)); } catch {}
    }, 200);
  }

  record(chunkKey, index, type) {
    const entry = this.data[chunkKey] || { indices: [], values: [] };
    const pos = entry.indices.indexOf(index);
    if (pos >= 0) entry.values[pos] = type | 0;
    else { entry.indices.push(index); entry.values.push(type | 0); }
    this.data[chunkKey] = entry;
    this.persist();
  }

  applyToChunk(chunk, chunkX, chunkZ) {
    const key = `${chunkX},${chunkZ}`;
    const edits = this.data[key];
    if (!edits || !chunk?.voxels) return;
    const vox = chunk.voxels;
    for (let i = 0; i < edits.indices.length; i++) {
      const idx = edits.indices[i];
      const val = edits.values[i] | 0;
      if (idx >= 0 && idx < vox.length) vox[idx] = val;
    }
  }
}