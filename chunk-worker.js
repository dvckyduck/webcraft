// Minimal terrain generator inside worker (mirrors WorldGenerator logic)
self.onmessage = (e) => {
  const { chunkX, chunkZ, sizeX, sizeY, sizeZ, worldType } = e.data;
  // Use Uint16Array to support block IDs > 255
  const voxels = new Uint16Array(sizeX * sizeY * sizeZ);
  const strideY = sizeX;
  const strideZ = sizeX * sizeY;
  // If a flat world is requested, create exact layer layout:
  // y=0 -> bedrock (id 4), y=1..2 -> dirt (id 3), y=3 -> grass (id 1)
  if (worldType === 'flat') {
    for (let x = 0; x < sizeX; x++) {
      for (let z = 0; z < sizeZ; z++) {
        for (let y = 0; y < sizeY; y++) {
          const index = x + y * sizeX + z * sizeX * sizeY;
          if (y === 0) voxels[index] = 4;
          else if (y === 1 || y === 2) voxels[index] = 3;
          else if (y === 3) voxels[index] = 1;
          else voxels[index] = 0;
        }
      }
    }
    self.postMessage({ chunkX, chunkZ, voxels }, [voxels.buffer]);
    return;
  }
  // Fast integer hash noise (no trig)
  const rand = (x, y) => { let h = ((x * 374761393) ^ (y * 668265263)) >>> 0; h = (h ^ (h >>> 13)) * 1274126177; return (((h ^ (h >>> 16)) >>> 0) / 4294967295); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const fade = (t) => t * t * (3 - 2 * t);
  const valueNoise = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = x0 + 1, y1 = y0 + 1;
    const sx = fade(x - x0), sy = fade(y - y0);
    const n00 = rand(x0, y0), n10 = rand(x1, y0), n01 = rand(x0, y1), n11 = rand(x1, y1);
    return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
  };
  const fbm = (x, y) => { let amp = 1, freq = 0.03, sum = 0, norm = 0; for (let i = 0; i < 6; i++) { sum += (valueNoise(x * freq, y * freq) * 2 - 1) * amp; norm += amp; amp *= 0.5; freq *= 2; } return sum / norm; };
  const base = 48;
  for (let x = 0; x < sizeX; x++) {
    const wxBase = chunkX * sizeX + x;
    for (let z = 0; z < sizeZ; z++) {
      const wz = chunkZ * sizeZ + z;
      const hVal = fbm(wxBase, wz) * 28; // similar roughness to previous
      const height = Math.max(0, Math.min(sizeY - 1, (base + hVal) | 0));
      const colBase = x + z * strideZ;
      const dirtStart = Math.max(0, height - 3);
      // Stone
      for (let y = 0; y < dirtStart; y++) voxels[colBase + y * strideY] = 2;
      // Dirt
      for (let y = dirtStart; y < height; y++) voxels[colBase + y * strideY] = 3;
      // Grass top
      voxels[colBase + height * strideY] = 1;
      // Trees: grow on grass with small probability
      const r = rand(wxBase, wz);
      if (voxels[colBase + height * strideY] === 1 && r < 0.03) {
        // shorten trunk by one so the top log sits under the leaf canopy
        const trunkH = 4 + ((r * 997) | 0) % 3; // nominal 4..6
        for (let ty = 1; ty < trunkH && height + ty < sizeY; ty++) voxels[colBase + (height + ty) * strideY] = 50;
        const topY = Math.min(sizeY - 1, height + trunkH - 1);
        const placeLayer = (ly, rad) => { for (let ox=-rad; ox<=rad; ox++) for (let oz=-rad; oz<=rad; oz++) {
          if (Math.abs(ox)===rad && Math.abs(oz)===rad && rand(wxBase+ox, wz+oz) < 0.5) continue;
          const nx=x+ox, nz=z+oz; if (nx<0||nx>=sizeX||nz<0||nz>=sizeZ||ly<0||ly>=sizeY) continue;
          const i = nx + ly * sizeX + nz * sizeX * sizeY; if (voxels[i]===0) voxels[i]=70; } };
        // Thinner canopy: reduce radii to make leaves less thick
        placeLayer(topY-2, 2);
        placeLayer(topY-1, 1);
        placeLayer(topY, 1);
        if (topY+1 < sizeY && rand(wxBase+31, wz+17) < 0.8) placeLayer(topY+1, 1);
        if (topY+2 < sizeY && rand(wxBase+47, wz+29) < 0.4) placeLayer(topY+2, 0);
      }
    }
  }
  self.postMessage({ chunkX, chunkZ, voxels }, [voxels.buffer]);
};