import * as THREE from 'three';
import nipplejs from 'nipplejs';

export class PlayerControls {
    constructor(canvas, camera, velocity, moveSpeed = 10, mouseSensitivity = 0.002, isMobile = false, integrateExternally = false) {
        this.canvas = canvas;
        this.camera = camera;
        this.velocity = velocity;
        this.moveSpeed = moveSpeed;
        this.mouseSensitivity = mouseSensitivity;
        this.isMobile = isMobile;
        this.integrateExternally = integrateExternally;
        this.jumpRequested = false;

        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.isPointerLocked = false;
        this.joystick = null;
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.tmpForward = new THREE.Vector3(); // reuse to avoid allocs
        this.tmpRight = new THREE.Vector3();   // reuse to avoid allocs

        this.setupEventListeners();
        this.syncCameraRotation();
    }

    // Capture initial camera rotation to sync mouse values
    syncCameraRotation() {
        // Approximate current rotation values for the mouse look
        this.mouse.x = this.camera.rotation.y;
        this.mouse.y = this.camera.rotation.x;
    }

    setupEventListeners() {
        // Mouse controls
        this.canvas.addEventListener('click', () => {
            if (!this.isMobile) {
                // Don't request pointer lock if inventory (or any overlay) is open
                if (document.getElementById('inventoryOverlay')?.classList.contains('open')) return;
                // requestPointerLock may return a Promise in some browsers — handle rejections to avoid unhandledrejection.
                const p = this.canvas.requestPointerLock?.();
                if (p && typeof p.catch === 'function') p.catch(() => {});
            }
        });

        document.addEventListener('pointerlockchange', () => {
            this.isPointerLocked = document.pointerLockElement === this.canvas;
        });

        document.addEventListener('mousemove', (event) => {
            if (this.isPointerLocked) {
                this.mouse.x -= event.movementX * this.mouseSensitivity;
                this.mouse.y -= event.movementY * this.mouseSensitivity;
                this.mouse.y = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.mouse.y));
            }
        });

        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            const key = event.code.toLowerCase().replace('key', '');
            if (key === 'space') {
                this.keys[' '] = true;
                this.jumpRequested = true;
                event.preventDefault();
            } else if (key === 'shiftleft' || key === 'shiftright') {
                this.keys.shift = true;
            } else {
                this.keys[key] = true;
            }
        });

        document.addEventListener('keyup', (event) => {
            const key = event.code.toLowerCase().replace('key', '');
            if (key === 'space') {
                this.keys[' '] = false;
                event.preventDefault();
            } else if (key === 'shiftleft' || key === 'shiftright') {
                this.keys.shift = false;
            } else {
                this.keys[key] = false;
            }
        });

        // Touch controls for mobile (look)
        if (this.isMobile) {
            this.canvas.addEventListener('touchstart', (e) => {
                // Only use the second touch for camera rotation if a joystick is also present
                // Otherwise, use the first touch
                const touch = e.touches[1] || e.touches[0];
                this.touchStartX = touch.clientX;
                this.touchStartY = touch.clientY;
            }, { passive: false });

            this.canvas.addEventListener('touchmove', (e) => {
                // Prevent scrolling etc.
                if (e.touches.length > 0) e.preventDefault();

                const touch = e.touches[1] || e.touches[0]; // Use second touch for camera if available
                const deltaX = touch.clientX - this.touchStartX;
                const deltaY = touch.clientY - this.touchStartY;

                this.mouse.x -= deltaX * this.mouseSensitivity * 0.5;
                this.mouse.y -= deltaY * this.mouseSensitivity * 0.5;
                this.mouse.y = Math.max(-Math.PI/2, Math.min(Math.PI/2, this.mouse.y));

                this.touchStartX = touch.clientX;
                this.touchStartY = touch.clientY;
            }, { passive: false });

            // Mobile joystick for movement
            this.joystick = nipplejs.create({
                zone: document.body,
                mode: 'static',
                position: { left: '80px', bottom: '80px' },
                color: 'white',
                size: 100
            });

            this.joystick.on('move', (evt, data) => {
                const force = Math.min(data.force, 1);
                const angle = data.angle.radian;

                this.keys.w = Math.cos(angle - Math.PI/2) * force > 0.5;
                this.keys.s = Math.cos(angle + Math.PI/2) * force > 0.5;
                this.keys.a = Math.sin(angle - Math.PI) * force > 0.5;
                this.keys.d = Math.sin(angle) * force > 0.5;
            });

            this.joystick.on('end', () => {
                this.keys.w = this.keys.s = this.keys.a = this.keys.d = false;
            });
        }
    }

    update(deltaTime) {
        // Mouse look
        this.camera.rotation.y = this.mouse.x;
        this.camera.rotation.x = this.mouse.y;

        // Movement intent (forward/right on XZ plane)
        const forward = this.tmpForward.set(0, 0, -1);
        const right = this.tmpRight.set(1, 0, 0);
        forward.applyQuaternion(this.camera.quaternion);
        right.applyQuaternion(this.camera.quaternion);

        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // When externally integrated, we only compute intent; otherwise preserve old fly mode
        if (this.integrateExternally) {
            // Store desired horizontal velocity direction on this.velocity (y handled by physics)
            this.velocity.set(0, this.velocity.y, 0);
            const speed = this.moveSpeed;
            if (this.keys.w) this.velocity.add(forward.clone().multiplyScalar(speed));
            if (this.keys.s) this.velocity.sub(forward.clone().multiplyScalar(speed));
            if (this.keys.a) this.velocity.sub(right.clone().multiplyScalar(speed));
            if (this.keys.d) this.velocity.add(right.clone().multiplyScalar(speed));
        } else {
            this.velocity.multiplyScalar(0.8); // Damping
            if (this.keys.w) this.velocity.add(forward.clone().multiplyScalar(this.moveSpeed * deltaTime));
            if (this.keys.s) this.velocity.sub(forward.clone().multiplyScalar(this.moveSpeed * deltaTime));
            if (this.keys.a) this.velocity.sub(right.clone().multiplyScalar(this.moveSpeed * deltaTime));
            if (this.keys.d) this.velocity.add(right.clone().multiplyScalar(this.moveSpeed * deltaTime));
            if (this.keys[' ']) this.velocity.y += this.moveSpeed * deltaTime;
            if (this.keys.shift) this.velocity.y -= this.moveSpeed * deltaTime;
            this.camera.position.add(this.velocity);
        }
    }

    getMoveInput() {
        // Returns desired horizontal velocity vector (XZ), magnitude ~ moveSpeed
        return new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    }

    consumeJumpRequested() {
        const j = this.jumpRequested;
        this.jumpRequested = false;
        return j;
    }
}