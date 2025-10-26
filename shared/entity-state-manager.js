"use strict";
/**
 * EntityStateManager - Manages epoch counters and timestamps for xRegistry entities
 *
 * This class provides consistent state management for xRegistry entities across all
 * registry implementations, ensuring proper handling of:
 * - Epoch values for optimistic concurrency control
 * - Creation timestamps (immutable once set)
 * - Modification timestamps (updated on changes)
 *
 * Based on xRegistry specification 1.0-rc2
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityStateManager = void 0;
class EntityStateManager {
    constructor() {
        this.epochs = new Map();
        this.createdTimestamps = new Map();
        this.modifiedTimestamps = new Map();
    }
    /**
     * Get the current epoch value for an entity path
     * Returns 1 if not previously set (initial epoch)
     */
    getEpoch(path) {
        return this.epochs.get(path) || 1;
    }
    /**
     * Increment the epoch value for an entity path
     * Also updates the modification timestamp
     * Returns the new epoch value
     */
    incrementEpoch(path) {
        const current = this.getEpoch(path);
        const next = current + 1;
        this.epochs.set(path, next);
        this.modifiedTimestamps.set(path, new Date().toISOString());
        return next;
    }
    /**
     * Get the creation timestamp for an entity path
     * Initializes both created and modified timestamps if not previously set
     * Creation timestamp is immutable once set
     */
    getCreatedAt(path) {
        if (!this.createdTimestamps.has(path)) {
            const now = new Date().toISOString();
            this.createdTimestamps.set(path, now);
            this.modifiedTimestamps.set(path, now);
        }
        return this.createdTimestamps.get(path);
    }
    /**
     * Get the modification timestamp for an entity path
     * Initializes if not previously set
     */
    getModifiedAt(path) {
        if (!this.modifiedTimestamps.has(path)) {
            const now = new Date().toISOString();
            this.modifiedTimestamps.set(path, now);
        }
        return this.modifiedTimestamps.get(path);
    }
    /**
     * Update the modification timestamp for an entity path
     * Use when entity metadata changes but epoch doesn't need incrementing
     */
    touch(path) {
        this.modifiedTimestamps.set(path, new Date().toISOString());
    }
}
exports.EntityStateManager = EntityStateManager;
//# sourceMappingURL=entity-state-manager.js.map