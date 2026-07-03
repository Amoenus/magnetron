import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    BITMAGNET_URL: z.string().url().default("http://bitmagnet:3333"),
    BITMAGNET_SOURCE: z.string().min(1).default("manual-web"),
    QBITTORRENT_URL: z.string().url().default("http://qbittorrent:8080"),
    QBITTORRENT_API_KEY: z.string().optional().default(""),
    QBITTORRENT_CATEGORY: z.string().default("discord-intake"),
    QBITTORRENT_TAGS: z.string().default("discord-intake"),
    TMDB_API_KEY: z.string().optional().default(""),
    DEFAULT_ACTION: z.enum(["index", "download", "both"]).default("index"),
    MAGNETRON_VERSION: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    // NEXT_PUBLIC_CLIENTVAR: z.string(),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    BITMAGNET_URL: process.env.BITMAGNET_URL,
    BITMAGNET_SOURCE: process.env.BITMAGNET_SOURCE,
    QBITTORRENT_URL: process.env.QBITTORRENT_URL,
    QBITTORRENT_API_KEY: process.env.QBITTORRENT_API_KEY,
    QBITTORRENT_CATEGORY: process.env.QBITTORRENT_CATEGORY,
    QBITTORRENT_TAGS: process.env.QBITTORRENT_TAGS,
    TMDB_API_KEY: process.env.TMDB_API_KEY,
    DEFAULT_ACTION: process.env.DEFAULT_ACTION,
    MAGNETRON_VERSION: process.env.MAGNETRON_VERSION,
    // NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
