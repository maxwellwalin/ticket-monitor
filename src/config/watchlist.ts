import type { WatchlistConfig } from "./schema";

const watchlist: WatchlistConfig = {
  settings: {
    email: "you@example.com",
    default_max_price: 100,
    alert_cooldown_hours: 6,
    geo_filter: {
      country_code: "US",
      lat: 33.6633,
      lon: -117.9033,
      range: "120mi",
    },
  },
  artists: [
    { name: "Angine de Poitrine", max_price: 150 },
    { name: "KNOWER", max_price: 100 },
    { name: "Tame Impala", max_price: 200 },
    { name: "TOOL", max_price: 200 },
    { name: "Geese", max_price: 150 },
    { name: "Prostitute", max_price: 80 },
    { name: "Maruja", max_price: 80 },
    { name: "Psychedelic Porn Crumpets", max_price: 80 },
    { name: "King Gizzard & The Lizard Wizard", max_price: 150 },
    { name: "Queens of the Stone Age", max_price: 200 },
  ],
  events: [],
};

export default watchlist;
