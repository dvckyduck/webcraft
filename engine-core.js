import * as THREE from 'three';
import { TextureAtlasBuilder } from './texture-atlas-builder.js';
import { WorldGenerator } from './world-generator.js';
import { ChunkMesher, VoxelDataAccessor } from './chunk-mesher.js';
import { BlockTypes } from './block-types.js';
import { UVRegistry } from './uv-registry.js';
import { SavedEditsStore } from './saved-edits.js';

export class VoxelEngine {
    constructor(options = {}) {
        this.chunkSizeX = 16;
        this.chunkSizeY = 128;
        this.chunkSizeZ = 16;
        // detect per-world type from saved world metadata (created by main.js)
        let worldType = 'normal';
        try {
            const metaRaw = localStorage.getItem('voxel_world_meta_v1');
            if (metaRaw && options.persistKey && options.persistKey.startsWith('voxel_world:')) {
                const meta = JSON.parse(metaRaw || '{}');
                const worldName = options.persistKey.split(':')[1];
                if (meta[worldName] && meta[worldName].type) worldType = meta[worldName].type;
            }
        } catch (e) { /* ignore */ }
        this.chunks = new Map();
        this.textureAtlasBuilder = new TextureAtlasBuilder();
        this.worldGenerator = new WorldGenerator(this.chunkSizeX, this.chunkSizeY, this.chunkSizeZ, worldType);
        this.textureAtlas = null;
        this.material = null;
        this.chunkMesher = null;
        this.buildQueue = [];
        this.buildQueueSet = new Set();
        this.totalTriangles = 0;
        this.workerPool = [];
        this.pendingGen = new Set();
        this.genQueue = [];
        this.maxWorkers = Math.min(8, navigator.hardwareConcurrency || 4);
        this.idleScheduled = false;
        this._persistKey = options.persistKey || 'voxel_saved_edits_v1';
        this.blockTypes = new BlockTypes();
        this.uvRegistry = new UVRegistry(this._persistKey);
        this.savedEditsStore = new SavedEditsStore(this._persistKey);
        this.loadSavedEdits();
        this.lodScale = 1;
    }

    async initResources() {
        this.textureAtlas = await this.textureAtlasBuilder.buildAtlas();
        this.textureAtlas.wrapS = THREE.ClampToEdgeWrapping;
        this.textureAtlas.wrapT = THREE.ClampToEdgeWrapping;
        this.material = new THREE.MeshBasicMaterial({ map: this.textureAtlas, side: THREE.FrontSide, fog: false });
        this.material.alphaTest = 0.5;
        this.material.transparent = false;
        this.material.depthWrite = true;
        this.material.color = new THREE.Color(0xffffff);
        this.material.needsUpdate = true;
        this.chunkMesher = new ChunkMesher(
            this.material,
            this.textureAtlasBuilder.texSizeX,
            this.textureAtlasBuilder.texSizeY,
            this.textureAtlasBuilder.tilesPerRow
        );
        this.uvRegistry.applyToMesher(this.chunkMesher);
        this.blockTypes.setupMesher(this.chunkMesher);
        // remove legacy/manual plant/cactus registration that referenced undefined fields
        // (handled by BlockTypes.setupMesher)
        for (let i = 0; i < this.maxWorkers; i++) this.spawnWorker();
    }

    loadSavedEdits() {
        try {
            const raw = localStorage.getItem(this._persistKey);
            if (raw) this.savedEdits = JSON.parse(raw) || {};
        } catch (e) { console.warn('Failed to load saved edits', e); }
    }

    spawnWorker() {
        try {
            const w = new Worker('./chunk-worker.js', { type: 'module' });
            w.busy = false;
            w.onmessage = (e) => {
                w.busy = false;
                const { chunkX, chunkZ, voxels } = e.data;
                const key = `${chunkX},${chunkZ}`;
                const chunk = this.chunks.get(key);
                if (chunk) {
                    chunk.voxels = voxels;
                    this.savedEditsStore.applyToChunk(chunk, chunkX, chunkZ);
                    this._sanitizeRemovedIds(chunk);
                    chunk.dirty = true;
                    this.enqueueBuild(key);
                }
                this.pendingGen.delete(key);
                this.pumpGeneration();
            };
            this.workerPool.push(w);
        } catch (err) {
            console.warn("Worker spawn failed, falling back to main-thread gen:", err);
            this.maxWorkers = 0;
        }
    }

    scheduleGeneration(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (!this.pendingGen.has(key)) {
            this.pendingGen.add(key);
            this.genQueue.push({ chunkX, chunkZ });
            this.pumpGeneration();
        }
    }

    pumpGeneration() {
        if (!this.maxWorkers) {
            const task = this.genQueue.shift();
            if (task) {
                const voxels = this.worldGenerator.generateChunkData(task.chunkX, task.chunkZ);
                const key = `${task.chunkX},${task.chunkZ}`;
                const chunk = this.chunks.get(key);
                if (chunk) {
                    chunk.voxels = voxels;
                    this.savedEditsStore.applyToChunk(chunk, task.chunkX, task.chunkZ);
                    this._sanitizeRemovedIds(chunk);
                    chunk.dirty = true;
                    this.enqueueBuild(key);
                }
                this.pendingGen.delete(key);
                if (this.genQueue.length) this.pumpGeneration();
            }
            return;
        }
        const idle = this.workerPool.find(w => !w.busy);
        if (!idle) return;
        const task = this.genQueue.shift();
        if (!task) return;
        idle.busy = true;
        // include worldType so the worker can produce flat worlds when requested
        idle.postMessage({
            chunkX: task.chunkX,
            chunkZ: task.chunkZ,
            sizeX: this.chunkSizeX,
            sizeY: this.chunkSizeY,
            sizeZ: this.chunkSizeZ,
            worldType: this.worldGenerator.worldType
        });
        if (this.genQueue.length) this.pumpGeneration();
    }

    generateChunk(chunkX, chunkZ) {
        const key = `${chunkX},${chunkZ}`;
        if (this.chunks.has(key)) return this.chunks.get(key);
        const chunk = { voxels: null, mesh: null, dirty: false, building: false, x: chunkX, z: chunkZ, lodGeomLevel: 0, lodTexLevel: 0, trianglesOnMesh: 0 };
        this.chunks.set(key, chunk);
        this.scheduleGeneration(chunkX, chunkZ);
        return chunk;
    }

    isVoxelSolidWorld(_chunkX, _chunkZ, worldX, worldY, worldZ) {
        if (worldY < 0 || worldY >= this.chunkSizeY) return false;
        const cx = Math.floor(worldX / this.chunkSizeX);
        const cz = Math.floor(worldZ / this.chunkSizeZ);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk?.voxels) return false;
        const lx = worldX - cx * this.chunkSizeX;
        const lz = worldZ - cz * this.chunkSizeZ;
        const t = VoxelDataAccessor.getVoxelType(chunk, lx, worldY, lz, this.chunkSizeX, this.chunkSizeY);
        if (this.blockTypes.isNonSolid(t)) return false;
        return t > 0;
    }

    getVoxelTypeWorld(worldX, worldY, worldZ) {
        if (worldY < 0 || worldY >= this.chunkSizeY) return 0;
        const cx = Math.floor(worldX / this.chunkSizeX);
        const cz = Math.floor(worldZ / this.chunkSizeZ);
        const chunk = this.chunks.get(`${cx},${cz}`);
        if (!chunk?.voxels) return 0;
        const lx = worldX - cx * this.chunkSizeX;
        const lz = worldZ - cz * this.chunkSizeZ;
        return VoxelDataAccessor.getVoxelType(chunk, lx, worldY, lz, this.chunkSizeX, this.chunkSizeY);
    }

    buildChunkMesh(chunk, offsetX, offsetZ) {
        const mesh = this.chunkMesher.buildMesh(
            chunk, offsetX, offsetZ, this.chunkSizeX, this.chunkSizeY,
            VoxelDataAccessor, this.isVoxelSolidWorld.bind(this), this.getVoxelTypeWorld.bind(this),
            chunk.lodGeomLevel, chunk.lodTexLevel
        );
        const prev = chunk.trianglesOnMesh || 0;
        if (!mesh) {
            this.totalTriangles -= prev;
            chunk.trianglesOnMesh = 0;
            return null;
        }
        const tris = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.getAttribute('position').count / 3;
        this.totalTriangles += tris - prev;
        chunk.trianglesOnMesh = tris;
        return mesh;
    }

    getVisibleChunks(camPos, renderDist) {
        const cx = Math.floor(camPos.x / this.chunkSizeX);
        const cz = Math.floor(camPos.z / this.chunkSizeZ);
        const cr = Math.ceil(renderDist / Math.max(this.chunkSizeX, this.chunkSizeZ)) + 1;
        const chunks = [];
        for (let x = cx - cr; x <= cx + cr; x++) for (let z = cz - cr; z <= cz + cr; z++) {
            const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
            if (d2 <= cr * cr) chunks.push({ x, z, d: d2 });
        }
        chunks.sort((a, b) => a.d - b.d);
        return chunks;
    }

    enqueueBuild(key, highPriority = false) {
        if (!this.buildQueueSet.has(key)) {
            this.buildQueueSet.add(key);
            if (highPriority) this.buildQueue.unshift(key);
            else this.buildQueue.push(key);
        }
    }

    processBuildQueue(scene, budgetMs = 6) {
        const start = performance.now();
        while (this.buildQueue.length && (performance.now() - start) < budgetMs) {
            const key = this.buildQueue.shift();
            this.buildQueueSet.delete(key);
            const chunk = this.chunks.get(key);
            if (!chunk?.voxels || !chunk.dirty || chunk.building) continue;
            const mesh = this.buildChunkMesh(chunk, chunk.x * this.chunkSizeX, chunk.z * this.chunkSizeZ);
            if (mesh && !mesh.parent) scene.add(mesh);
        }
        if (this.buildQueue.length && !this.idleScheduled) {
            this.idleScheduled = true;
            (window.requestIdleCallback || ((fn)=>setTimeout(()=>fn({timeRemaining:()=>16}),0)))(() => {
                this.idleScheduled = false;
                this.processBuildQueue(scene, 12);
            });
        }
    }

    update(scene, camPos, renderDist) {
        const visible = this.getVisibleChunks(camPos, renderDist);
        const active = new Set();
        for (const { x, z } of visible) {
            const key = `${x},${z}`;
            active.add(key);
            const chunk = this.chunks.get(key) || this.generateChunk(x, z);
            const dx = x - Math.floor(camPos.x / this.chunkSizeX);
            const dz = z - Math.floor(camPos.z / this.chunkSizeZ);
            const dist = Math.hypot(dx, dz);
            const ls = this.lodScale || 1;
            const desiredGeom = dist > 60 * ls ? 3 : dist > 40 * ls ? 2 : dist > 20 * ls ? 1 : 0;
            if (chunk.lodGeomLevel !== desiredGeom) { chunk.lodGeomLevel = desiredGeom; chunk.dirty = true; }
            if ((chunk.dirty || !chunk.mesh) && !chunk.building && chunk.voxels) this.enqueueBuild(key);
        }
        for (const [key, chunk] of this.chunks) {
            if (!active.has(key) && chunk.mesh?.parent) {
                this.totalTriangles -= chunk.trianglesOnMesh || 0;
                chunk.trianglesOnMesh = 0;
                scene.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
                chunk.mesh = null;
                chunk.dirty = true;
            }
        }
        return { chunkCount: active.size, triangleCount: Math.floor(this.totalTriangles) };
    }

    onRenderDistanceChanged(camPos, renderDist) {
        const cx = Math.floor(camPos.x / this.chunkSizeX);
        const cz = Math.floor(camPos.z / this.chunkSizeZ);
        const cr = Math.ceil(renderDist / Math.max(this.chunkSizeX, this.chunkSizeZ)) + 1;
        const tasks = [];
        for (let x = cx - cr; x <= cx + cr; x++) for (let z = cz - cr; z <= cz + cr; z++) {
            const dx = x - cx, dz = z - cz;
            if (dx * dx + dz * dz <= cr * cr) tasks.push({ chunkX: x, chunkZ: z, d2: dx * dx + dz * dz });
        }
        tasks.sort((a, b) => a.d2 - b.d2);
        this.genQueue = tasks.map(t => ({ chunkX: t.chunkX, chunkZ: t.chunkZ }));
        this.pendingGen = new Set(this.genQueue.map(t => `${t.chunkX},${t.chunkZ}`));
        this.pumpGeneration();
    }

    setVoxelWorld(worldX, worldY, worldZ, type) {
        if (worldY < 0 || worldY >= this.chunkSizeY) return false;
        const cx = Math.floor(worldX / this.chunkSizeX);
        const cz = Math.floor(worldZ / this.chunkSizeZ);
        const key = `${cx},${cz}`;
        const lx = worldX - cx * this.chunkSizeX, lz = worldZ - cz * this.chunkSizeZ;
        const chunk = this.chunks.get(key) || this.generateChunk(cx, cz);
        if (!chunk.voxels) chunk.voxels = this.worldGenerator.generateChunkData(cx, cz);
        const i = VoxelDataAccessor.idx(lx, worldY, lz, this.chunkSizeX, this.chunkSizeY);
        chunk.voxels[i] = (type === 1001 ? 0 : type) | 0;
        chunk.dirty = true; this.enqueueBuild(key, true); // prioritize immediate rebuild for edited chunk
        this.savedEditsStore.record(key, i, type | 0);
        const markNeighbor = (nx, nz) => {
            const nKey = `${nx},${nz}`;
            const nChunk = this.chunks.get(nKey) || this.generateChunk(nx, nz);
            if (nChunk) { nChunk.dirty = true; this.enqueueBuild(nKey, true); } // prioritize neighbor too
        };
        if (lx === 0) markNeighbor(cx - 1, cz);
        else if (lx === this.chunkSizeX - 1) markNeighbor(cx + 1, cz);
        if (lz === 0) markNeighbor(cx, cz - 1);
        else if (lz === this.chunkSizeZ - 1) markNeighbor(cx, cz + 1);
        return true;
    }

    registerUVBlock(u, v) {
        const id = this.uvRegistry.register(u, v, this.chunkMesher);
        this.blockTypes.maybeMarkPlant(u, id, this.chunkMesher);
        this.blockTypes.maybeMarkCactus(u, id, this.chunkMesher);
        return id;
    }

    applyRegisteredUVBlocks() {
        this.uvRegistry.applyToMesher(this.chunkMesher);
    }

    applySavedEditsToChunk(chunk, chunkX, chunkZ) {
        this.savedEditsStore.applyToChunk(chunk, chunkX, chunkZ);
    }

    _sanitizeRemovedIds(chunk) {
        const vox = chunk.voxels; if (!vox) return;
        for (let i = 0; i < vox.length; i++) if (vox[i] === 1001) vox[i] = 0;
    }
}

window.VoxelEngine = VoxelEngine;