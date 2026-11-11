export interface EventBroadcasterPort {
  broadcast(event: string, data: unknown): void;
}
