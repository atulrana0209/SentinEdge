/**
 * Fast in-memory deduplication cache with sliding expiration and DB fallback.
 * Prevents duplicate events from triggering duplicate downstream processing or duplicate incidents.
 */
class DedupCache {
  constructor(maxSize = 20000, ttlMs = 1000 * 60 * 60) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map(); // eventId -> { timestamp: number }
    this.duplicateCount = 0;
  }

  /**
   * Check if an eventId has already been seen.
   * If seen, returns true.
   * If not seen, records it and returns false.
   * @param {string} eventId
   * @param {import('better-sqlite3').Database} [db]
   * @returns {boolean} isDuplicate
   */
  isDuplicate(eventId, db) {
    if (!eventId) return false;

    const now = Date.now();

    // 1. Check in-memory LRU map
    if (this.cache.has(eventId)) {
      const entry = this.cache.get(eventId);
      if (now - entry.timestamp < this.ttlMs) {
        this.duplicateCount++;
        return true;
      }
      // Expired in map
      this.cache.delete(eventId);
    }

    // 2. Check SQLite persistent store if provided
    if (db) {
      try {
        const stmt = db.prepare('SELECT id FROM events WHERE id = ?');
        const existing = stmt.get(eventId);
        if (existing) {
          this.cache.set(eventId, { timestamp: now });
          this.duplicateCount++;
          return true;
        }
      } catch (err) {
        console.error('[DedupCache] Error checking DB for duplicate:', err);
      }
    }

    // 3. Mark as seen in memory
    this.record(eventId);
    return false;
  }

  record(eventId) {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest 10% entries
      const evictCount = Math.floor(this.maxSize * 0.1);
      const keys = this.cache.keys();
      for (let i = 0; i < evictCount; i++) {
        const key = keys.next().value;
        if (key) this.cache.delete(key);
      }
    }
    this.cache.set(eventId, { timestamp: Date.now() });
  }

  getStats() {
    return {
      cachedEntries: this.cache.size,
      maxSize: this.maxSize,
      totalDuplicatesDetected: this.duplicateCount
    };
  }

  clear() {
    this.cache.clear();
    this.duplicateCount = 0;
  }
}

module.exports = new DedupCache();
