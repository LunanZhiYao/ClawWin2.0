export declare function resolvePairingPaths(baseDir: string | undefined, subdir: string): {
    dir: string;
    pendingPath: string;
    pairedPath: string;
};
export declare function readJsonFile<T>(filePath: string): Promise<T | null>;
export declare function writeJsonAtomic(filePath: string, value: unknown): Promise<void>;
export declare function pruneExpiredPending<T extends {
    ts: number;
}>(pendingById: Record<string, T>, nowMs: number, ttlMs: number): void;
export declare function createAsyncLock(): <T>(fn: () => Promise<T>) => Promise<T>;
