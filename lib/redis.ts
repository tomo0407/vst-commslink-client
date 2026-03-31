import { Redis } from '@upstash/redis';

/** Singleton Redis client. Uses UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. */
export const kv = Redis.fromEnv();
