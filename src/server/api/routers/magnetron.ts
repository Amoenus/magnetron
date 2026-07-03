import { z } from "zod";

import { intakeSchema } from "~/lib/magnetron";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  getCatalog,
  getReadiness,
  getSettings,
  searchTmdb,
  submitIntake,
} from "~/server/magnetron";

export const magnetronRouter = createTRPCRouter({
  settings: publicProcedure.query(() => getSettings()),
  readiness: publicProcedure.query(() => getReadiness()),
  catalog: publicProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          page: z.number().int().min(1).default(1),
        })
        .optional()
    )
    .query(({ input }) => getCatalog(input?.limit ?? 20, input?.page ?? 1)),
  submit: publicProcedure
    .input(intakeSchema)
    .mutation(({ input }) => submitIntake(input)),
  searchTmdb: publicProcedure
    .input(
      z.object({
        query: z.string().trim().min(0),
        contentType: z.string(),
      })
    )
    .query(({ input }) => searchTmdb(input.query, input.contentType)),
});
