export class UVRegistry {
  constructor(persistKey) {
    this._persistKey = (persistKey || 'voxel_saved_edits_v1') + ':uvRegistry';
    this.map = new Map();
    this.nextId = 1000;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this._persistKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.map) this.map = new Map(Object.entries(data.map).map(([k, v]) => [k, v | 0]));
      if (Number.isFinite(data?.nextId)) this.nextId = data.nextId | 0;
    } catch {}
  }

  persist() {
    try {
      const obj = { map: Object.fromEntries(this.map.entries()), nextId: this.nextId };
      localStorage.setItem(this._persistKey, JSON.stringify(obj));
    } catch {}
  }

  applyToMesher(chunkMesher) {
    if (!chunkMesher) return;
    for (const [key, id] of this.map.entries()) {
      const [u, v] = key.split(',').map(Number);
      chunkMesher.blockUVMap[id] = {
        '+y': { u, v },
        '+x': { u, v: v + 1 }, '-x': { u, v: v + 1 }, '-z': { u, v: v + 1 },
        '-y': { u, v: v + 2 },
        '+z': { u, v: v + 3 },
        all: { u, v: v + 1 }
      };
    }
  }

  register(u, v, chunkMesher) {
    const key = `${u},${v}`;
    if (this.map.has(key)) return this.map.get(key);
    const id = this.nextId++;
    // write the 4-tile mapping immediately
    if (chunkMesher) {
      chunkMesher.blockUVMap[id] = {
        '+y': { u, v },
        '+x': { u, v: v + 1 }, '-x': { u, v: v + 1 }, '-z': { u, v: v + 1 },
        '-y': { u, v: v + 2 },
        '+z': { u, v: v + 3 },
        all: { u, v: v + 1 }
      };
    }
    this.map.set(key, id);
    this.persist();
    return id;
  }
}