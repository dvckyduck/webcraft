import * as THREE from 'three';

/* exported function updatePhysics(rendererInstance, dt) */
export function updatePhysics(self, dt) {
    const g = -30, maxSpeed = 6, accel = 30, friction = 12, jumpSpeed = 14;
    // If in creative mode (flying), bypass normal gravity/friction and allow free vertical control.
    const isCreative = !!self.isCreative;
    const desired = self.playerControls.getMoveInput();
    // Horizontal movement: keep existing walk mechanics
    const horizVel = new THREE.Vector3(self.player.vel.x, 0, self.player.vel.z);
    if (desired.lengthSq() > 0) {
        desired.setLength(maxSpeed);
        const toAdd = desired.sub(horizVel);
        const change = Math.max(0, Math.min(1, accel * dt));
        horizVel.add(toAdd.multiplyScalar(change));
    } else {
        const f = Math.max(0, 1 - friction * dt);
        horizVel.multiplyScalar(f);
    }
    self.player.vel.x = horizVel.x; self.player.vel.z = horizVel.z;
    if (isCreative) {
        // In creative, directly map vertical intent (space / shift) to vertical velocity without gravity.
        // PlayerControls populates keys.space via jumpRequested; use simple mapping:
        const up = self.playerControls.keys[' '] ? 1 : 0;
        const down = self.playerControls.keys.shift ? 1 : 0;
        const flySpeed = 10;
        self.player.vel.y = (up - down) * flySpeed;
        self.player.grounded = false;
    } else {
        self.player.vel.y += g * dt;
        if (self.player.grounded && self.playerControls.consumeJumpRequested()) {
            self.player.vel.y = jumpSpeed; self.player.grounded = false;
        }
    }
    const pos = self.camera.position;
    const tryMove = (ax, amt) => {
        if (amt === 0) return 0;
        const r = self.player.radius, h = self.player.height, eye = self.player.eyeHeight;
        pos[ax] += amt;
        const min = { x: pos.x - r, y: pos.y - eye, z: pos.z - r };
        const max = { x: pos.x + r, y: pos.y - eye + h, z: pos.z + r };
        // Apply tiny epsilon to avoid boundary-case rounding that causes sticking on integer Y (and other) levels
        const EPS = 1e-6;
        const x0 = Math.floor(min.x + EPS), x1 = Math.floor(max.x - EPS);
        const y0 = Math.floor(min.y + EPS), y1 = Math.floor(max.y - EPS);
        const z0 = Math.floor(min.z + EPS), z1 = Math.floor(max.z - EPS);
        let pushed = 0;
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
            // get actual voxel type and skip non-solid/air. Use per-block inset for cactus hitbox.
            const vt = self.voxelEngine.getVoxelTypeWorld(x, y, z);
            if (vt === 0 || self.voxelEngine.blockTypes.isNonSolid(vt)) continue;
            const isCactus = self.voxelEngine.blockTypes.cactusBlockIds.has(vt);
            const inset = isCactus ? (1/16) : 0;
            const vxMinX = x + inset, vxMaxX = x + 1 - inset, vxMinY = y, vxMaxY = y + 1, vxMinZ = z + inset, vxMaxZ = z + 1 - inset;
            const overlapX = Math.min(max.x, vxMaxX) - Math.max(min.x, vxMinX);
            const overlapY = Math.min(max.y, vxMaxY) - Math.max(min.y, vxMinY);
            const overlapZ = Math.min(max.z, vxMaxZ) - Math.max(min.z, vxMinZ);
            if (overlapX > 0 && overlapY > 0 && overlapZ > 0) {
                if (ax === 'x') { if (amt > 0) { pos.x -= overlapX; pushed = -overlapX; } else { pos.x += overlapX; pushed = overlapX; } }
                else if (ax === 'y') { if (amt > 0) { pos.y -= overlapY; pushed = -overlapY; } else { pos.y += overlapY; pushed = overlapY; self.player.grounded = true; } }
                else if (ax === 'z') { if (amt > 0) { pos.z -= overlapZ; pushed = -overlapZ; } else { pos.z += overlapZ; pushed = overlapZ; } }
                min.x = pos.x - r; min.y = pos.y - eye; min.z = pos.z - r;
                max.x = pos.x + r; max.y = pos.y - eye + h; max.z = pos.z + r;
            }
        }
        return pushed;
    };
    self.player.grounded = false;
    const dx = self.player.vel.x * dt, dy = self.player.vel.y * dt, dz = self.player.vel.z * dt;
    const maxDisp = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.ceil(maxDisp / 0.25));
    const stepDt = dt / steps;
    for (let i = 0; i < steps; i++) {
        if (!isCreative) self.player.vel.y += g * stepDt;
        const sdx = self.player.vel.x * stepDt, sdz = self.player.vel.z * stepDt, sdy = self.player.vel.y * stepDt;
        if (tryMove('x', sdx) !== 0) self.player.vel.x = 0;
        if (tryMove('z', sdz) !== 0) self.player.vel.z = 0;
        if (tryMove('y', sdy) !== 0) self.player.vel.y = 0;
    }
}