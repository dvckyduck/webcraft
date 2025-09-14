import * as THREE from 'three';
import { TextureAtlasBuilder } from './texture-atlas-builder.js';
import { WorldGenerator } from './world-generator.js';
import { ChunkMesher, VoxelDataAccessor } from './chunk-mesher.js';

// Ensure we import the class before re-exporting and assigning to window to avoid a ReferenceError.
import { VoxelEngine } from './engine-core.js';
export { VoxelEngine };
window.VoxelEngine = VoxelEngine;