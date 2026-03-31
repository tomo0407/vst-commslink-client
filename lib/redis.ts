import { Redis } from '@upstash/redis';

/** Singleton Redis client. Uses KV_REST_API_URL / KV_REST_API_TOKEN (Vercel KV env names). */
export const kv = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
