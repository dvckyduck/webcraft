import * as THREE from 'three';

export function addGreedyTopFaces({
  chunk,
  worldChunkOffsetX,
  worldChunkOffsetZ,
  chunkSizeX,
  chunkSizeY,
  step,
  getVoxelTypeLOD,
  blockUVMap,
  texSizeX,
  texSizeY,
  positions,
  normals,
  uvs,
  indices,
  plantBlockIds,
  cactusBlockIds,
  glassBlockIds
}) {
  const cols = Math.ceil(chunkSizeX / step);
  const rows = Math.ceil(chunkSizeX / step);
  const grid = new Uint16Array(cols * rows);
  const yLevels = Math.ceil(chunkSizeY / step);

  const idx2 = (x, z) => x + z * cols;

  // For each y-slab, add top faces via greedy rectangles
  for (let y = 0; y < chunkSizeY; y += step) {
    // Build mask of exposed top faces at this y (LOD 'step'-aligned)
    for (let gz = 0; gz < rows; gz++) {
      const z = gz * step;
      for (let gx = 0; gx < cols; gx++) {
        const x = gx * step;
        const t = getVoxelTypeLOD(chunk, x, y, z, step, chunkSizeX, chunkSizeY);
        // Treat plant-type blocks as having no flat top
        if (plantBlockIds.has(t)) { grid[idx2(gx, gz)] = 0; continue; }
        // Exposed on +Y?
        const aboveType = getVoxelTypeLOD(chunk, x, y + step, z, step, chunkSizeX, chunkSizeY);
        const aboveIsSolidBase = aboveType !== 0 && !plantBlockIds.has(aboveType) && !cactusBlockIds.has(aboveType);
        const aboveIsGlass = glassBlockIds.has(aboveType);
        const selfIsGlass = glassBlockIds.has(t);
        const aboveSolid = aboveIsGlass ? (selfIsGlass && aboveType === t) : aboveIsSolidBase; // glass connects only to same id
        grid[idx2(gx, gz)] = aboveSolid ? 0 : t;
      }
    }

    // Greedy merge on grid
    let z = 0;
    while (z < rows) {
      let x = 0;
      while (x < cols) {
        const t = grid[idx2(x, z)];
        if (t === 0) { x++; continue; }
        // Find width
        let w = 1;
        while (x + w < cols && grid[idx2(x + w, z)] === t) w++;
        // Find height
        let h = 1;
        outer: for (; z + h < rows; h++) {
          for (let k = 0; k < w; k++) {
            if (grid[idx2(x + k, z + h)] !== t) { break outer; }
          }
        }
        // Clear used cells
        for (let dz = 0; dz < h; dz++) {
          for (let dx = 0; dx < w; dx++) {
            grid[idx2(x + dx, z + dz)] = 0;
          }
        }
        // Emit per-tile quads to avoid stretched textures across merged areas
        for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) {
          const wy = y + step, eps = 0.0;
          const uvInfo = (blockUVMap[t] && (blockUVMap[t]['+y'] || blockUVMap[t].all)) || { u: 0, v: 0 };
          const baseU = uvInfo.u * texSizeX, baseV = uvInfo.v * texSizeY;
          const x0 = worldChunkOffsetX + (x + dx) * step, z0 = worldChunkOffsetZ + (z + dz) * step;
          const x1 = x0 + step, z1 = z0 + step, start = positions.length / 3;
          positions.push(x0 - eps, wy + eps, z1 + eps, x1 + eps, wy + eps, z1 + eps, x1 + eps, wy + eps, z0 - eps, x0 - eps, wy + eps, z0 - eps);
          normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
          uvs.push(baseU, baseV + texSizeY, baseU + texSizeX, baseV + texSizeY, baseU + texSizeX, baseV, baseU, baseV);
          indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }

        x += w;
      }
      z++;
    }
  }
}