import * as THREE from 'three';
import { HotbarUI } from './hotbar-ui.js';
import { InventoryUI } from './inventory-ui.js';

export class HotbarInventory {
  constructor() {
    // Tombstone: large inline implementation moved to hotbar-ui.js and inventory-ui.js
    // removed function buildHotbarAndInventory() {}
    // removed function bindGlobalShortcuts() {}
    // removed many helper/render functions...
    this.hotbarUI = new HotbarUI();
    this.inventoryUI = new InventoryUI(this.hotbarUI);

    // wire high-level API expected by other modules
    this.inventoryOverlay = document.getElementById('inventoryOverlay');
    this.hotbarEl = document.getElementById('hotbar');
    this.inventoryGrid = document.getElementById('inventoryGrid');
    this.selectedHotbarIndex = 0;
    this._persistKey = 'voxel_inventory_v1';

    // re-expose minimal public API implemented by the new modules
    this.bindGlobalShortcuts = () => this.hotbarUI.bindGlobalShortcuts();
    this.toggleInventory = (force) => this.inventoryUI.toggleInventory(force);
    this.selectHotbarIndex = (i) => this.hotbarUI.selectHotbarIndex(i);
    this.updateHotbarSelection = () => this.hotbarUI.updateHotbarSelection();
    this.saveInventory = () => this.hotbarUI.saveInventory();
    this.loadInventory = () => this.hotbarUI.loadInventory();
    this.setPersistKey = (k) => {
      if (k) this._persistKey = `${k}:inventory`;
      this.hotbarUI.setPersistKey(this._persistKey);
      this.inventoryUI.setPersistKey(this._persistKey);
    };

    // initialize
    this.hotbarUI.initialize(this.hotbarEl, this.inventoryGrid, this._persistKey);
    this.inventoryUI.initialize(this.hotbarEl, this.inventoryGrid, this._persistKey);
    this.bindGlobalShortcuts();
    // defer loading until a per-world persist key can be supplied by the renderer
    // (VoxelRenderer will call loadInventory after calling setPersistKey)
  }
}