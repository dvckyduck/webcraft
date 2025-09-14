export class BlockTypes {
  constructor() {
    this.crossBlockId = 10;
    this.nonSolidBlockIds = new Set([this.crossBlockId]);
    this.plantColumns = new Set([8, 9, 10, 18, 20, 51, 52, 53]);
    this.explicitPlantIds = new Set([9, 19, 21, 52, 53, 54]);
    this.cactusBlockIds = new Set([17]); // cactus is block id 17 (sides inset)
    this.cactusColumns = new Set([16]); // column index for cactus (id = u + 1)
    this.glassBlockIds = new Set([13, 67, 70]); // glass ids (solid for physics; special cull rules)
  }

  setupMesher(chunkMesher) {
    if (!chunkMesher) return;
    // register plant ids mapped by column (ids are u+1)
    const plantIdsFromCols = Array.from(this.plantColumns).map(u => u + 1);
    plantIdsFromCols.forEach(id => { chunkMesher.plantBlockIds.add(id); this.nonSolidBlockIds.add(id); });
    // explicit plant ids
    this.explicitPlantIds.forEach(id => { chunkMesher.plantBlockIds.add(id); this.nonSolidBlockIds.add(id); });
    // cactus ids
    this.cactusBlockIds.forEach(id => { chunkMesher.cactusBlockIds.add(id); });
    // register glass ids for special culling (not nonSolid)
    this.glassBlockIds.forEach(id => { chunkMesher.glassBlockIds.add(id); });
  }

  maybeMarkPlant(columnU, newId, chunkMesher) {
    if (this.plantColumns.has(columnU)) {
      chunkMesher?.plantBlockIds?.add(newId);
      this.nonSolidBlockIds.add(newId);
    }
  }

  maybeMarkCactus(columnU, newId, chunkMesher) {
    if (this.cactusColumns.has(columnU)) {
      this.cactusBlockIds.add(newId);
      chunkMesher?.cactusBlockIds?.add(newId);
    }
  }

  isNonSolid(id) { return id === this.crossBlockId || this.nonSolidBlockIds.has(id); }
}