/** Typed Ticketmaster Discovery API response interfaces */

export interface TmApiVenue {
  name?: string;
  city?: { name?: string };
  state?: { stateCode?: string };
  country?: { countryCode?: string };
}

export interface TmApiAttraction {
  id: string;
  name: string;
}

export interface TmApiPresale {
  name?: string;
  startDateTime?: string;
  endDateTime?: string;
  url?: string;
}

export interface TmApiPriceRange {
  min: number;
  max: number;
  currency?: string;
}

export interface TmApiEvent {
  id: string;
  name: string;
  url?: string;
  dates?: {
    start?: {
      dateTime?: string;
      localDate?: string;
    };
    status?: {
      code?: string;
    };
  };
  sales?: {
    public?: {
      startDateTime?: string;
    };
    presales?: TmApiPresale[];
  };
  priceRanges?: TmApiPriceRange[];
  _embedded?: {
    venues?: TmApiVenue[];
    attractions?: TmApiAttraction[];
  };
}
