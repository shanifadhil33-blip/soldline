export class RateLimited extends Error {
  readonly retryable = true;
  constructor(public readonly retryAt: number) { super('Provider request limit reached'); this.name = 'RateLimited'; }
}
export class Retryable extends Error {
  readonly retryable = true;
  constructor(message: 'Provider is temporarily unavailable' | 'simulated outage' = 'Provider is temporarily unavailable') { super(message); this.name = 'Retryable'; }
}
export class NeedsReconnect extends Error {
  readonly retryable = false;
  constructor() { super('Please reconnect this provider'); this.name = 'NeedsReconnect'; }
}
export class ConnectionPaused extends Error {
  readonly retryable = false;
  constructor() { super('This provider is paused'); this.name = 'ConnectionPaused'; }
}
export class ProviderRejected extends Error {
  readonly retryable = false;
  constructor() { super('Provider refused this request'); this.name = 'ProviderRejected'; }
}
