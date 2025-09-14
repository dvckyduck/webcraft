import * as THREE from 'three';
import { addGreedyTopFaces } from './greedy-top-mesher.js';

export class ChunkMesher {
    constructor(material, texSizeX, texSizeY, tilesPerRow) { // Accept separate texSizeX/texSizeY and tilesPerRow
        this.material = material;
        this.geometryPool = [];
        this.meshPool = [];
        this.tilesPerRow = tilesPerRow; // Use dynamically passed value
        this.texSizeX = texSizeX;       // horizontal UV scale (u)
        this.texSizeY = texSizeY;       // vertical UV scale (v)

        // Build blockUVMap dynamically so there is exactly one block per column.
        // For each column (u) map the vertical tiles (rows) using the user's rule.
        this.blockUVMap = {};
        const rows = Math.max(1, Math.round(1 / (this.texSizeY || 1))); // number of tiles in column
        for (let col = 0; col < this.tilesPerRow; col++) {
            let base = {};
            if (rows === 1) {
                base = { all: { u: col, v: 0 } };
            } else if (rows === 2) {
                // first (v=0): top & bottom, second (v=1): sides
                base['+y'] = { u: col, v: 0 }; base['-y'] = { u: col, v: 0 };
                base['+x'] = base['-x'] = base['+z'] = base['-z'] = { u: col, v: 1 };
                base.all = base.all || base['+x'];
            } else if (rows === 3) {
                // v=0 top, v=1 sides, v=2 bottom
                base['+y'] = { u: col, v: 0 };
                base['+x'] = base['-x'] = base['-z'] = { u: col, v: 1 }; // sides except front mapped to v=1
                base['-y'] = { u: col, v: 2 };
                base.all = base.all || base['+x'];
            } else {
                // v=0 top, v=1 sides (except front), v=2 bottom, v=3 front (+Z)
                base['+y'] = { u: col, v: 0 };
                base['+x'] = base['-x'] = base['-z'] = { u: col, v: 1 }; // sides except front mapped to v=1
                base['-y'] = { u: col, v: 2 };
                base['+z'] = { u: col, v: 3 }; // front face uses fourth texture
                base.all = base.all || base['+x'];
            }
            // Ensure 'all' fallback exists
            base.all = base.all || base['+y'] || { u: col, v: 0 };
            this.blockUVMap[col + 1] = base; // voxel type = column index + 1
        }
        // Mark a reserved id for crossed plants (column-based mapping may not include custom id 10).
        this.crossBlockId = 10;
        this.plantBlockIds = new Set([10]); // treat these ids as crossed, non-solid plants
        this.cactusBlockIds = new Set([17]); // ids whose side faces are inset by 1/16th
        this.glassBlockIds = new Set([13, 67]); // glass ids for special neighbor culling
    }

    // Per-face UV mapping that keeps "up" aligned with +Y for vertical faces,
    // and a consistent orientation for top/bottom. This computes local UVs (0 to 1) for a single tile.
    computeUV(normal, corner) {
        let u = 0, v = 0;
        const [cx, cy, cz] = corner;
        if (normal[0] === 1) {        // +X (right)
            u = 1 - cz; v = 1 - cy;
        } else if (normal[0] === -1) { // -X (left)
            u = cz; v = 1 - cy;
        } else if (normal[1] === 1) {  // +Y (top)
            u = cx; v = 1 - cz;
        } else if (normal[1] === -1) { // -Y (bottom)
            u = cx; v = cz;
        } else if (normal[2] === 1) {  // +Z (front)
            u = cx; v = 1 - cy;
        } else if (normal[2] === -1) { // -Z (back)
            u = 1 - cx; v = 1 - cy;
        }
        return [u, v];
    }

    // Per-face directional bias multipliers (classic fake shading)
    faceMultiplier(faceType) {
        // Disable any per-face tinting so block textures render at full color.
        return 1.0;
    }

    buildMesh(chunk, worldChunkOffsetX, worldChunkOffsetZ, chunkSizeX, chunkSizeY, VoxelDataAccessor, isVoxelSolidWorldFunc, getVoxelTypeWorldFunc, lodGeomLevel = 0, lodTexLevel = 0) {
        if (!chunk.dirty) return chunk.mesh;
        const step = 1 << (lodGeomLevel | 0);

        chunk.building = true;

        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];
        let vertexCount = 0;

        // Ensure all faces use CCW winding when viewed from the outside
        const faces = [
            // -Y (bottom)
            { dir: [0, -1, 0], corners: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], normal: [0, -1, 0], faceKey: '-y' },
            // +Z (front)
            { dir: [0, 0, 1],  corners: [[0,1,1],[0,0,1],[1,0,1],[1,1,1]], normal: [0, 0, 1],  faceKey: '+z' },
            // -Z (back)
            { dir: [0, 0, -1], corners: [[1,1,0],[1,0,0],[0,0,0],[0,1,0]], normal: [0, 0, -1], faceKey: '-z' },
            // +X (right)
            { dir: [1, 0, 0],  corners: [[1,1,0],[1,1,1],[1,0,1],[1,0,0]], normal: [1, 0, 0],  faceKey: '+x' },
            // -X (left)
            { dir: [-1, 0, 0], corners: [[0,1,1],[0,1,0],[0,0,0],[0,0,1]], normal: [-1, 0, 0], faceKey: '-x' }
        ];

        addGreedyTopFaces({
            chunk, worldChunkOffsetX, worldChunkOffsetZ, chunkSizeX, chunkSizeY,
            step, getVoxelTypeLOD: this.getVoxelTypeLOD.bind(this),
            blockUVMap: this.blockUVMap, texSizeX: this.texSizeX, texSizeY: this.texSizeY,
            positions, normals, uvs, indices,
            plantBlockIds: this.plantBlockIds,
            cactusBlockIds: this.cactusBlockIds,
            glassBlockIds: this.glassBlockIds
        });
        vertexCount = positions.length / 3;

        for (let x = 0; x < chunkSizeX; x += step) {
            for (let y = 0; y < chunkSizeY; y += step) {
                for (let z = 0; z < chunkSizeX; z += step) { // chunkSizeZ is chunkSizeX in this iteration
                    const voxelType = this.getVoxelTypeLOD(chunk, x, y, z, step, chunkSizeX, chunkSizeY);
                    if (voxelType === 0) continue;

                    // Crossed-quad plant rendering
                    if (this.plantBlockIds.has(voxelType)) {
                        const cx = worldChunkOffsetX + x + 0.5;
                        const cy = y + 0.0;
                        const cz = worldChunkOffsetZ + z + 0.5;
                        const half = 0.5 * step;
                        const start = vertexCount;
                        // Prefer the column's top tile for plants (v=0), fallback to 'all'
                        const uvBaseInfo = (this.blockUVMap[voxelType] && (this.blockUVMap[voxelType]['+y'] || this.blockUVMap[voxelType].all)) || { u: 0, v: 0 };
                        const baseU = uvBaseInfo.u * this.texSizeX;
                        const baseV = uvBaseInfo.v * this.texSizeY;
                        // quad size uses one tile
                        const u0 = baseU;
                        const v0 = baseV + this.texSizeY;
                        const u1 = baseU + this.texSizeX;
                        const v1 = baseV;

                        // First diagonal quad (\)
                        positions.push(
                            cx - half, cy, cz - half,
                            cx + half, cy, cz + half,
                            cx + half, cy + step, cz + half,
                            cx - half, cy + step, cz - half
                        );
                        for (let i=0;i<4;i++) normals.push(0,0,1); // normals aren't used for lighting but keep attribute
                        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
                        indices.push(start, start+1, start+2, start, start+2, start+3);
                        // add reverse-wound triangles so plant quad is visible from both sides
                        indices.push(start, start+2, start+1, start, start+3, start+2);
                        vertexCount += 4;

                        // Second diagonal quad (/)
                        const s2 = vertexCount;
                        positions.push(
                            cx + half, cy, cz - half,
                            cx - half, cy, cz + half,
                            cx - half, cy + step, cz + half,
                            cx + half, cy + step, cz - half
                        );
                        for (let i=0;i<4;i++) normals.push(0,0,1);
                        uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
                        indices.push(s2, s2+1, s2+2, s2, s2+2, s2+3);
                        // add reverse-wound triangles for second plant quad
                        indices.push(s2, s2+2, s2+1, s2, s2+3, s2+2);
                        vertexCount += 4;
                        continue;
                    }

                    const worldX = worldChunkOffsetX + x;
                    const worldY = y;
                    const worldZ = worldChunkOffsetZ + z;

                    for (const face of faces) {
                        const [dx, dy, dz] = face.dir;
                        const nx = x + dx * step, ny = y + dy * step, nz = z + dz * step;

                        let neighborSolid = false;
                        if (nx >= 0 && nx < chunkSizeX &&
                            ny >= 0 && ny < chunkSizeY &&
                            nz >= 0 && nz < chunkSizeX) { // chunkSizeZ is chunkSizeX here
                            const nt = this.getVoxelTypeLOD(chunk, nx, ny, nz, step, chunkSizeX, chunkSizeY);
                            neighborSolid = nt !== 0 && !this.plantBlockIds.has(nt) && !this.cactusBlockIds.has(nt);
                            const neighborIsGlass = this.glassBlockIds.has(nt), selfIsGlass = this.glassBlockIds.has(voxelType);
                            if (neighborIsGlass && selfIsGlass) neighborSolid = (nt === voxelType); // only connect same glass id
                            else if (neighborIsGlass && !selfIsGlass) neighborSolid = false; // glass next to non-glass: render face
                        } else {
                            const nt = getVoxelTypeWorldFunc(worldX + dx * step, worldY + dy * step, worldZ + dz * step) | 0;
                            neighborSolid = nt !== 0 && !this.plantBlockIds.has(nt) && !this.cactusBlockIds.has(nt);
                            const neighborIsGlass = this.glassBlockIds.has(nt), selfIsGlass = this.glassBlockIds.has(voxelType);
                            if (neighborIsGlass && selfIsGlass) neighborSolid = (nt === voxelType);
                            else if (neighborIsGlass && !selfIsGlass) neighborSolid = false;
                        }

                        // For cactus blocks, always render side faces even when touching a solid neighbor,
                        // because cactus sides are inset and remain visible.
                        const isCactus = this.cactusBlockIds && this.cactusBlockIds.has(voxelType);
                        const isSideFace = face.faceKey === '+x' || face.faceKey === '-x' || face.faceKey === '+z' || face.faceKey === '-z';
                        if (isCactus && isSideFace) neighborSolid = false;

                        if (!neighborSolid) {
                            const startVertex = vertexCount;
                            const eps = 0.0; // avoid overlap that causes clipping between adjacent faces
                            const applyInset = isCactus && step === 1;
                            const inset = applyInset ? (1 / 16) : 0;

                            // Positions and normals
                            for (const corner of face.corners) {
                                const cx = corner[0], cy = corner[1], cz = corner[2];
                                let lx = cx * step, lz = cz * step;
                                if (inset) {
                                    if (face.faceKey === '+x') { lx = step - inset; lz = cz ? (step - inset) : inset; }
                                    else if (face.faceKey === '-x') { lx = inset; lz = cz ? (step - inset) : inset; }
                                    else if (face.faceKey === '+z') { lz = step - inset; lx = cx ? (step - inset) : inset; }
                                    else if (face.faceKey === '-z') { lz = inset; lx = cx ? (step - inset) : inset; }
                                }
                                positions.push(worldX + lx + (cx === 0 ? -eps : eps), worldY + cy * step + (cy === 0 ? -eps : eps), worldZ + lz + (cz === 0 ? -eps : eps));
                                normals.push(...face.normal);
                            }

                            // UVs per corner (face-aligned)
                            // Get base UVs for the specific voxel type and face from the blockUVMap
                            const blockTypeUVs = this.blockUVMap[voxelType];
                            let tileUV = blockTypeUVs ? (blockTypeUVs[face.faceKey] || blockTypeUVs['all']) : null; // Try specific face, then 'all' fallback
                            
                            if (!tileUV) {
                                console.warn(`No UV map found for voxelType: ${voxelType}, faceKey: ${face.faceKey}. Using default (0,0).`);
                                tileUV = { u: 0, v: 0 }; // Default to (0,0) if not found
                            }

                            const baseU = tileUV.u * this.texSizeX;
                            const baseV = tileUV.v * this.texSizeY; // V is top-down due to texture.flipY = false

                            // No overscan/poke: always use exact 16x16 tile UVs so cactus uses a regular tile (no wider texture)
                            for (const corner of face.corners) {
                                const [localU, localV] = this.computeUV(face.normal, corner);
                                uvs.push(baseU + localU * this.texSizeX * step, baseV + localV * this.texSizeY * step);
                            }

                            // Indices (CCW)
                            indices.push(
                                startVertex, startVertex + 1, startVertex + 2,
                                startVertex, startVertex + 2, startVertex + 3
                            );

                            vertexCount += 4;
                        }
                    }
                }
            }
        }

        if (positions.length === 0) {
            if (chunk.mesh && chunk.mesh.parent) {
                chunk.mesh.parent.remove(chunk.mesh);
                chunk.mesh.geometry.dispose();
            }
            chunk.mesh = null;
            chunk.dirty = false;
            chunk.building = false;
            return null;
        }

        let geometry = this.geometryPool.pop();
        if (!geometry) {
            geometry = new THREE.BufferGeometry();
        } else {
            geometry.dispose(); // Dispose previous attributes if reused
            geometry = new THREE.BufferGeometry(); // Create new buffer geometry
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        if (chunk.mesh) {
            chunk.mesh.geometry.dispose(); // Dispose old geometry
            chunk.mesh.parent?.remove(chunk.mesh);
        }

        chunk.mesh = new THREE.Mesh(geometry, this.material);
        chunk.mesh.frustumCulled = true;
        chunk.mesh.matrixAutoUpdate = false;
        chunk.mesh.updateMatrix();
        chunk.dirty = false;
        chunk.building = false;

        return chunk.mesh;
    }

    getVoxelTypeLOD(chunk, x, y, z, step, chunkSizeX, chunkSizeY) {
        // pick topmost non-air within the step^3 region for stable appearance
        for (let yy = Math.min(y + step - 1, chunkSizeY - 1); yy >= y; yy--) {
            for (let zz = z; zz < Math.min(z + step, chunkSizeX); zz++) {
                for (let xx = x; xx < Math.min(x + step, chunkSizeX); xx++) {
                    const t = VoxelDataAccessor.getVoxelType(chunk, xx, yy, zz, chunkSizeX, chunkSizeY);
                    if (t) return t;
                }
            }
        }
        return 0;
    }
}

// Utility to access voxel data within a chunk
// Kept separate as it's a pure helper for data access
export class VoxelDataAccessor {
    static idx(x, y, z, chunkSizeX, chunkSizeY) {
        return x + y * chunkSizeX + z * chunkSizeX * chunkSizeY;
    }

    static isVoxelSolid(chunk, x, y, z, chunkSizeX, chunkSizeY) {
        if (x < 0 || x >= chunkSizeX || y < 0 || y >= chunkSizeY || z < 0 || z >= chunkSizeX) { // chunkSizeX for Z
            return false;
        }
        const index = VoxelDataAccessor.idx(x, y, z, chunkSizeX, chunkSizeY);
        return chunk.voxels[index] > 0;
    }

    static getVoxelType(chunk, x, y, z, chunkSizeX, chunkSizeY) {
        if (x < 0 || x >= chunkSizeX || y < 0 || y >= chunkSizeY || z < 0 || z >= chunkSizeX) { // chunkSizeX for Z
            return 0;
        }
        const index = VoxelDataAccessor.idx(x, y, z, chunkSizeX, chunkSizeY);
        return chunk.voxels[index] | 0;
    }
}