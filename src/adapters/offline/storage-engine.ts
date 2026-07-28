/**
 * Asynchronous key-value storage engine interface and IndexedDB / in-memory implementations
 * for offline revision durability.
 */

export interface StorageEngineSeam {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  getAll(): Promise<Record<string, unknown>>;
}

export class InMemoryStorageEngine implements StorageEngineSeam {
  private store: Record<string, unknown> = {};

  get(key: string): Promise<unknown> {
    const hasKey = Object.prototype.hasOwnProperty.call(this.store, key);
    if (!hasKey) return Promise.resolve(null);
    return Promise.resolve(this.store[key]);
  }

  put(key: string, value: unknown): Promise<void> {
    this.store[key] = value;
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    const hasKey = Object.prototype.hasOwnProperty.call(this.store, key);
    if (hasKey) {
      delete this.store[key];
    }
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store = {};
    return Promise.resolve();
  }

  getAll(): Promise<Record<string, unknown>> {
    const copy = Object.assign({}, this.store);
    return Promise.resolve(copy);
  }
}

export class IndexedDBStorageEngine implements StorageEngineSeam {
  private fallback: InMemoryStorageEngine | null = null;
  private dbPromise: Promise<any> | null = null;
  readonly dbName: string;
  readonly storeName: string;

  constructor(
    dbName: string = "pyrepad_offline_db",
    storeName: string = "pyric_offline_revisions",
  ) {
    this.dbName = dbName;
    this.storeName = storeName;
    const hasIndexedDB =
      typeof globalThis !== "undefined" &&
      Boolean((globalThis as any).indexedDB);
    if (!hasIndexedDB) {
      this.fallback = new InMemoryStorageEngine();
    }
  }

  private async getDB(): Promise<any> {
    const isFallback = Boolean(this.fallback);
    if (isFallback) return null;
    const hasCachedDB = Boolean(this.dbPromise);
    if (hasCachedDB) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      try {
        const req = (globalThis as any).indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = (evt: any) => {
          const db = evt.target.result;
          const hasStore = db.objectStoreNames.contains(this.storeName);
          if (!hasStore) {
            db.createObjectStore(this.storeName);
          }
        };
        req.onsuccess = (evt: any) => resolve(evt.target.result);
        req.onerror = (evt: any) => reject(evt.target.error);
      } catch (err) {
        this.fallback = new InMemoryStorageEngine();
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async get(key: string): Promise<unknown> {
    const db = await this.getDB();
    const isFallback = Boolean(this.fallback || !db);
    if (isFallback) {
      return this.fallback!.get(key);
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readonly");
      const store = tx.objectStore(this.storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    const db = await this.getDB();
    const isFallback = Boolean(this.fallback || !db);
    if (isFallback) {
      return this.fallback!.put(key, value);
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.getDB();
    const isFallback = Boolean(this.fallback || !db);
    if (isFallback) {
      return this.fallback!.delete(key);
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    const isFallback = Boolean(this.fallback || !db);
    if (isFallback) {
      return this.fallback!.clear();
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readwrite");
      const store = tx.objectStore(this.storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAll(): Promise<Record<string, unknown>> {
    const db = await this.getDB();
    const isFallback = Boolean(this.fallback || !db);
    if (isFallback) {
      return this.fallback!.getAll();
    }
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const tx = db.transaction([this.storeName], "readonly");
      const store = tx.objectStore(this.storeName);
      const reqKeys = store.getAllKeys();
      const reqVals = store.getAll();
      tx.oncomplete = () => {
        const keys = reqKeys.result || [];
        const vals = reqVals.result || [];
        const result: Record<string, unknown> = {};
        for (let i = 0; i < keys.length; i++) {
          result[String(keys[i])] = vals[i];
        }
        resolve(result);
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}
