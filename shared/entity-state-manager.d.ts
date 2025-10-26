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
export declare class EntityStateManager {
    private epochs;
    private createdTimestamps;
    private modifiedTimestamps;
    /**
     * Get the current epoch value for an entity path
     * Returns 1 if not previously set (initial epoch)
     */
    getEpoch(path: string): number;
    /**
     * Increment the epoch value for an entity path
     * Also updates the modification timestamp
     * Returns the new epoch value
     */
    incrementEpoch(path: string): number;
    /**
     * Get the creation timestamp for an entity path
     * Initializes both created and modified timestamps if not previously set
     * Creation timestamp is immutable once set
     */
    getCreatedAt(path: string): string;
    /**
     * Get the modification timestamp for an entity path
     * Initializes if not previously set
     */
    getModifiedAt(path: string): string;
    /**
     * Update the modification timestamp for an entity path
     * Use when entity metadata changes but epoch doesn't need incrementing
     */
    touch(path: string): void;
}
//# sourceMappingURL=entity-state-manager.d.ts.map