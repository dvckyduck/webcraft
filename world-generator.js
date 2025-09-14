export class WorldGenerator {
    constructor(chunkSizeX = 16, chunkSizeY = 128, chunkSizeZ = 16, worldType = 'normal') {
        this.chunkSizeX = chunkSizeX;
        this.chunkSizeY = chunkSizeY;
        this.chunkSizeZ = chunkSizeZ;
        this.worldType = worldType;
    }

    // Generates voxel data for a chunk
    generateChunkData(chunkX, chunkZ) {
        const voxels = new Uint16Array(this.chunkSizeX * this.chunkSizeY * this.chunkSizeZ);
        const offsetX = chunkX * this.chunkSizeX;
        const offsetZ = chunkZ * this.chunkSizeZ;

        // Debug world: fill every block so the entire volume shows a visible grid pattern of tile IDs.
        if (this.worldType === 'debug') {
            const tilesPerRow = 16;
            const idx = (x, y, z) => x + y * this.chunkSizeX + z * this.chunkSizeX * this.chunkSizeY;
            for (let x = 0; x < this.chunkSizeX; x++) {
                for (let z = 0; z < this.chunkSizeZ; z++) {
                    const worldX = offsetX + x, worldZ = offsetZ + z;
                    const col = ((worldX & 15) + ((worldZ & 15) << 4)) % (tilesPerRow * tilesPerRow);
                    for (let y = 0; y < this.chunkSizeY; y++) voxels[idx(x, y, z)] = (col % 255) + 1;
                }
            }
            return voxels;
        }

        // Simple default terrain: flat grass layer at y=32 with stone below and air above.
        const groundY = Math.floor(this.chunkSizeY / 4);
        const idx = (x, y, z) => x + y * this.chunkSizeX + z * this.chunkSizeX * this.chunkSizeY;
        for (let x = 0; x < this.chunkSizeX; x++) {
            for (let z = 0; z < this.chunkSizeZ; z++) {
                for (let y = 0; y < this.chunkSizeY; y++) {
                    if (y < groundY - 2) voxels[idx(x, y, z)] = 2; // stone (id 2)
                    else if (y < groundY) voxels[idx(x, y, z)] = 3; // dirt (id 3)
                    else if (y === groundY) voxels[idx(x, y, z)] = 4; // grass (id 4)
                    else voxels[idx(x, y, z)] = 0; // air
                }
            }
        }

        // Add Minecraft-like oak trees (logs id 50, leaves id 70)
        const hash = (a, b) => { let h = ((a * 374761393) ^ (b * 668265263)) >>> 0; h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };
        // Create patchy tree density: per-chunk density value drives clustering (some chunks dense, others sparse)
        const chunkDensity = (hash(chunkX, chunkZ) & 0xffff) / 0xffff; // 0..1 per chunk
        const baseProb = 0.02; // baseline per-block spawn probability
        // Amplify probability non-linearly so some chunks become forested while others stay sparse
        const chunkProbMultiplier = 0.1 + Math.pow(chunkDensity, 2) * 12.0; // ~0.1..12.1
        for (let x = 0; x < this.chunkSizeX; x++) for (let z = 0; z < this.chunkSizeZ; z++) {
          const h = groundY; const r = hash(offsetX + x, offsetZ + z) / 0xffffffff;
          if (voxels[idx(x, h, z)] === 4 && r < baseProb * chunkProbMultiplier) {
            // shorten trunk one block so leaves cover the top without the log poking through
            const trunkH = 4 + (hash(offsetX + x + 13, offsetZ + z + 7) % 3);
            for (let ty = 1; ty < trunkH && h + ty < this.chunkSizeY; ty++) voxels[idx(x, h + ty, z)] = 50;
            const topY = Math.min(this.chunkSizeY - 1, h + trunkH - 1);
            const placeLayer = (ly, rad) => { for (let ox=-rad; ox<=rad; ox++) for (let oz=-rad; oz<=rad; oz++) {
              if (Math.abs(ox)===rad && Math.abs(oz)===rad && (hash(offsetX+x+ox, offsetZ+z+oz)&255) < 128) continue;
              const nx=x+ox, nz=z+oz; if (nx<0||nx>=this.chunkSizeX||nz<0||nz>=this.chunkSizeZ||ly<0||ly>=this.chunkSizeY) continue;
              const id = idx(nx, ly, nz); if (voxels[id]===0) voxels[id]=70; } };
            // Thinner canopy: reduce radii so leaves are less bulky
            // lower layer (slightly reduced)
            placeLayer(topY-2, 2);
            // main canopy body (narrower)
            placeLayer(topY-1, 1); placeLayer(topY-0, 1);
            // small crown / cap layers
            if (topY+1 < this.chunkSizeY) placeLayer(topY+1, 1);
            if (topY+2 < this.chunkSizeY && (hash(offsetX+x+31, offsetZ+z+17) & 1023) < 900) placeLayer(topY+2, 0);
          }
        }

        // Add flower patches (use block ids 10 and 11). These generate on grass (id 4) in small clustered patches.
        const flowerBaseProb = 0.01; // base chance per grass tile to start a small patch
        for (let x = 0; x < this.chunkSizeX; x++) for (let z = 0; z < this.chunkSizeZ; z++) {
          const worldHX = offsetX + x, worldHZ = offsetZ + z;
          if (voxels[idx(x, groundY, z)] !== 4) continue;
          const r = hash(worldHX, worldHZ) / 0xffffffff;
          if (r < flowerBaseProb) {
            // start a small patch radius 1..2 with 3..7 flowers
            const patchSize = 1 + (hash(worldHX + 11, worldHZ + 7) % 2);
            const count = 3 + (hash(worldHX + 19, worldHZ + 23) % 5);
            for (let i = 0; i < count; i++) {
              const ox = (hash(worldHX + i, worldHZ + 3) % (patchSize * 2 + 1)) - patchSize;
              const oz = (hash(worldHX + i + 7, worldHZ + 13) % (patchSize * 2 + 1)) - patchSize;
              const nx = x + ox, nz = z + oz;
              if (nx < 0 || nx >= this.chunkSizeX || nz < 0 || nz >= this.chunkSizeZ) continue;
              const groundId = voxels[idx(nx, groundY, nz)];
              const aboveIdIdx = idx(nx, groundY + 1, nz);
              if (groundId === 4 && voxels[aboveIdIdx] === 0) {
                // choose flower id 10 or 11 pseudo-randomly
                const pick = ((hash(worldHX + nx, worldHZ + nz) >> (i % 16)) & 1) === 0 ? 10 : 11;
                voxels[aboveIdIdx] = pick;
              }
            }
          }
        }

        return voxels;
    }
}