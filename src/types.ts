export type Group = 'A' | 'B' | 'C' | 'D';

export type Availability =
  | 'in_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'backorder'
  | 'limited'
  | 'discontinued'
  | 'unknown';

/** One interaction performed before reading the price, e.g. choosing a colour. */
export type VariantStep =
  /** Choose an option in a <select> by its value attribute. */
  | { action: 'select'; selector: string; value: string }
  /** Click an element (swatch, radio label, button). */
  | { action: 'click'; selector: string }
  /** Fail the run unless the element's value equals `value` (confirms a selection took effect). */
  | { action: 'expectValue'; selector: string; value: string };

export interface Target {
  /** Stable key used in data/prices.json. Don't change it once the target has history. */
  id: string;
  name: string;
  retailer: string;
  url: string;
  group: Group;
  /** Country the seller ships from, shown in the prices table. */
  country: string;
  /**
   * Whether the listed price already includes VAT. UK prices always do. For sellers outside the UK
   * showing prices without VAT, the prices table adds an estimate of the 20% UK import VAT.
   */
  vat: 'incl' | 'excl';
  /** Set to false to keep a target in the file without visiting it. */
  enabled?: boolean;
  /**
   * The page publishes a price range for its options (JSON-LD AggregateOffer). Track the lowest
   * price, i.e. the base price with the cheapest options.
   */
  priceFrom?: boolean;
  variant?: {
    /** Human description shown in reports, e.g. "Indigo Matte Special Edition". */
    label: string;
    steps: VariantStep[];
    /**
     * Case-insensitive regex tested against JSON-LD offers (product name, SKU, GTIN, URL, colour).
     * If set, a matching offer is used for the price. If not set, JSON-LD and meta tags are
     * skipped for variant targets, because they describe the page, not the selected variant.
     */
    offerMatch?: string;
  };
  /** CSS selectors tried in order after the structured data sources. First visible match wins. */
  selectors?: string[];
  /** Optional CSS selector whose text describes stock, used when structured data has none. */
  stockSelector?: string;
  /** Optional selector for a cookie banner button, if the generic handling doesn't catch it. */
  cookieSelector?: string;
  /** Free text shown in reports (e.g. "Prices exclude VAT"). */
  note?: string;
}

export type ScrapeStatus = 'ok' | 'not_found' | 'load_error' | 'blocked' | 'variant_error';

export type PriceSource = 'json-ld' | 'microdata' | 'meta' | 'selector';

export interface ScrapeResult {
  targetId: string;
  status: ScrapeStatus;
  price?: number;
  currency?: string;
  availability?: Availability;
  source?: PriceSource;
  /** The price converted to GBP at the run's exchange rate (same as `price` for GBP). */
  gbp?: number;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
  /** Diagnostic notes, e.g. which sources were skipped and why. */
  notes: string[];
}

export interface HistoryEntry {
  at: string;
  price: number;
  currency: string;
  /** GBP equivalent at the time of the reading. */
  gbp?: number;
  availability?: Availability;
  change: 'initial' | 'drop' | 'rise' | 'currency' | 'stock';
}

export interface TargetState {
  name: string;
  retailer: string;
  url: string;
  lastPrice?: number;
  currency?: string;
  /** GBP equivalent of `lastPrice` at the time it was read. */
  lastGbp?: number;
  /**
   * The price when monitoring started: set from the first successful reading and never changed
   * afterwards, as a fixed reference for how far the price has moved.
   */
  originalPrice?: number;
  originalCurrency?: string;
  originalAt?: string;
  availability?: Availability;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  consecutiveFailures: number;
  /** True once a failure alert has been sent for the current failure streak. */
  failureAlerted: boolean;
  lastError?: string;
  history: HistoryEntry[];
}

export interface State {
  version: 1;
  updatedAt?: string;
  /** Exchange rates used for the latest run's GBP conversions. */
  fx?: FxRates;
  targets: Record<string, TargetState>;
  exdemo?: ExDemoState;
}

/** A clearance / ex-demo listing page to search for a model, already filtered to one brand. */
export interface ExDemoPage {
  id: string;
  retailer: string;
  /** Which of the retailer's pages this is, e.g. "Clearance". */
  label: string;
  url: string;
  /** Every listing on the filtered page must mention this brand, or the filter hasn't applied. */
  brand: string;
  /** One element per product listing. */
  cardSelector: string;
  /** Within a card. */
  titleSelector: string;
  /** Within a card; defaults to the first link. */
  linkSelector?: string;
  /** Within a card, tried in order; the first visible one with a price wins. */
  priceSelectors: string[];
  /** Elements to ignore inside the price element, e.g. a crossed-out old price. */
  priceExclude?: string;
  /** Shown when the page has no products: a selector, and/or a regex for the page text. */
  emptySelector?: string;
  emptyText?: string;
  /** Condition to record when a listing doesn't state one, e.g. on an ex-demo-only page. */
  defaultCondition?: string;
}

export interface ExDemoListing {
  /** The listing URL without query string; identifies the unit across runs and pages. */
  key: string;
  title: string;
  price?: number;
  currency?: string;
  condition?: string;
  url: string;
}

export type ExDemoStatus = 'ok' | 'blocked' | 'load_error' | 'grid_not_found' | 'filter_not_applied';

export interface ExDemoPageResult {
  pageId: string;
  status: ExDemoStatus;
  /** Listings on the page (any model). */
  itemCount: number;
  /** Listings matching the watched model. */
  matches: ExDemoListing[];
  error?: string;
  notes: string[];
}

export interface ExDemoPageState {
  consecutiveFailures: number;
  failureAlerted: boolean;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastItemCount?: number;
}

export interface ExDemoListingState extends ExDemoListing {
  pageId: string;
  retailer: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Whether the listing was on its page at the last successful check of that page. */
  listed: boolean;
}

export interface ExDemoState {
  pages: Record<string, ExDemoPageState>;
  /** Every matching listing seen, keyed by `ExDemoListing.key`, so a unit is only reported once. */
  listings: Record<string, ExDemoListingState>;
}

export type ExDemoEvent =
  | { type: 'found'; listing: ExDemoListingState }
  | { type: 'cheaper'; listing: ExDemoListingState; oldPrice: number }
  | { type: 'page_failure'; pageId: string; consecutive: number; status: ExDemoStatus; error?: string }
  | { type: 'page_failure_alert'; pageId: string; consecutive: number; status: ExDemoStatus; error?: string }
  | { type: 'page_recovered'; pageId: string; afterFailures: number };

/** Units of each currency per 1 GBP, from the ECB reference rates published on `date`. */
export interface FxRates {
  date: string;
  perGbp: Record<string, number>;
}

export type MonitorEvent =
  | { type: 'first'; targetId: string; price: number; currency: string }
  | { type: 'same'; targetId: string }
  | { type: 'drop'; targetId: string; oldPrice: number; newPrice: number; currency: string; pctDrop: number }
  | { type: 'rise'; targetId: string; oldPrice: number; newPrice: number; currency: string; pctRise: number }
  | { type: 'currency_changed'; targetId: string; oldCurrency: string; newCurrency: string; price: number }
  | { type: 'failure'; targetId: string; consecutive: number; status: ScrapeStatus; error?: string }
  | { type: 'failure_alert'; targetId: string; consecutive: number; status: ScrapeStatus; error?: string }
  | { type: 'recovered'; targetId: string; afterFailures: number };
