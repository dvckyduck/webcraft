import * as THREE from 'three';

export class TextureAtlasBuilder {
    constructor(tileSize = 16) {
        this.tileSize = tileSize; // default 16px per tile
        this.tilesPerRow = 16;    // fallback, updated after loading
        this.texSize = 1 / 16;    // fallback UV size
        this._texture = null;     // cache for reuse
    }

    async buildAtlas(path = '201007301722_terrain (1).png') {
        // Return cached texture if already built
        if (this._texture) return this._texture;

        // Try requested path, then fallback to known project atlases to avoid missing-file crashes
        // prefer the newly added atlas (5) first, then fall back to other known atlases and the passed path
        const candidates = ['terrain.png', path, '201007301722_terrain (3).png', '201007301722_terrain (4).png'].filter(Boolean);
        let texture = null;
        for (const p of candidates) {
            try { texture = await new THREE.TextureLoader().loadAsync(p); break; } catch (err) { console.warn('Atlas load failed for', p, err); }
        }
        if (!texture) throw new Error('Failed to load any texture atlas (tried: ' + candidates.join(', ') + ')');

        // Pixel-art optimizations
        Object.assign(texture, {
            magFilter: THREE.NearestFilter,
            minFilter: THREE.NearestFilter,
            generateMipmaps: false,
            flipY: false
        });
        texture.colorSpace = THREE.SRGBColorSpace;

        const { width, height } = texture.image ?? {};
        if (width && height) {
            this.tilesPerRow = Math.floor(width / this.tileSize);
            // compute separate texSizeX (u) and texSizeY (v) so tiles remain square even if atlas isn't square
            this.texSizeX = this.tileSize / width;
            this.texSizeY = this.tileSize / height;
            this.texSize = this.texSizeX; // keep texSize for backward-compat where single scale is used
        } else {
            console.warn("Texture dimensions unavailable. Using fallback values.");
            this.tilesPerRow = 16;
            this.texSizeX = 1 / this.tilesPerRow;
            this.texSizeY = 1 / this.tilesPerRow;
            this.texSize = this.texSizeX;
        }

        this._texture = texture;
        return texture;
    }

    // Utility to compute UV offsets for a given tile index
    getUV(index) {
        const x = index % this.tilesPerRow;
        const y = Math.floor(index / this.tilesPerRow);
        return {
            u: x * this.texSizeX,
            v: y * this.texSizeY,
            size: this.texSize
        };
    }
}