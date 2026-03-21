import { z } from "zod";

const geoFilterSchema = z.object({
  dma_id: z.string().optional(),
  state_code: z.string().optional(),
  country_code: z.string().default("US"),
});

const artistWatchSchema = z.object({
  name: z.string(),
  max_price: z.number().positive().optional(),
});

const eventWatchSchema = z
  .object({
    name: z.string(),
    ticketmaster_event_id: z.string().optional(),
    ticketmaster_keyword: z.string().optional(),
    max_price: z.number().positive().optional(),
  })
  .refine((e) => e.ticketmaster_event_id || e.ticketmaster_keyword, {
    message:
      "Event watch must have either ticketmaster_event_id or ticketmaster_keyword",
  });

const settingsSchema = z.object({
  email: z.string().email(),
  default_max_price: z.number().positive(),
  alert_cooldown_hours: z.number().positive().default(6),
  geo_filter: geoFilterSchema.optional(),
});

export const watchlistSchema = z.object({
  settings: settingsSchema,
  artists: z.array(artistWatchSchema).default([]),
  events: z.array(eventWatchSchema).default([]),
});

export type WatchlistConfig = z.infer<typeof watchlistSchema>;
export type ArtistWatch = z.infer<typeof artistWatchSchema>;
export type EventWatch = z.infer<typeof eventWatchSchema>;
export type GeoFilter = z.infer<typeof geoFilterSchema>;
