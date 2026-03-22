export interface SgApiPerformer {
  id: number;
  name: string;
  short_name: string;
  slug: string;
  primary: boolean;
}

export interface SgApiVenue {
  id: number;
  name: string;
  city: string;
  state: string;
  country: string;
  url: string;
}

export interface SgApiStats {
  listing_count?: number;
  lowest_price?: number | null;
  highest_price?: number | null;
  average_price?: number | null;
}

export interface SgApiEvent {
  id: number;
  title: string;
  short_title: string;
  datetime_utc: string;
  time_tbd: boolean;
  date_tbd: boolean;
  venue?: SgApiVenue;
  performers?: SgApiPerformer[];
  stats: SgApiStats;
  url: string;
  status: string;
  is_open: boolean;
  type: string;
}

export interface SgApiEventsResponse {
  events: SgApiEvent[];
  meta: { total: number; page: number; per_page: number };
}

export interface SgApiPerformersResponse {
  performers: SgApiPerformer[];
  meta: { total: number; page: number; per_page: number };
}
