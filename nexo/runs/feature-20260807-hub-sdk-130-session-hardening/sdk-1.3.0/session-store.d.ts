interface HubSessionRecord {
    hubRefreshToken: string;
    accountId?: string;
    expiresAt?: string;
    absoluteExpiresAt?: string;
}
interface HubLoginTransaction {
    codeVerifier: string;
    state: string;
    expiresAt?: string;
}
interface HubSessionTransaction {
    get(): Promise<HubSessionRecord | null>;
    update(record: HubSessionRecord): Promise<void>;
    delete(): Promise<void>;
}
interface HubSessionStore {
    create(data: HubSessionRecord): Promise<string>;
    withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
    createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
    consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
}
declare class InMemoryHubSessionStore implements HubSessionStore {
    private readonly now;
    private readonly sessions;
    private readonly logins;
    private readonly queues;
    constructor(now?: () => number);
    create(data: HubSessionRecord): Promise<string>;
    withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
    createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
    consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
    /** Shared with the access-time expiry check above. */
    private isExpired;
    /**
     * Synchronous read, for TESTS only. Not part of {@link HubSessionStore}: no store
     * you write needs it, and `SqlHubSessionStore` does not have it. Do not build
     * against it.
     *
     * Applies the same expiry rule as `withSession`, so the two accessors on this class
     * cannot disagree about whether a session exists.
     */
    get(id: string): HubSessionRecord | null;
}

export { type HubSessionStore as H, InMemoryHubSessionStore as I, type HubSessionRecord as a, type HubSessionTransaction as b, type HubLoginTransaction as c };
