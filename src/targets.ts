import type { Target } from './types';

/** Price selectors for WooCommerce product pages after a variation has been chosen. */
const WOO_VARIATION_PRICE = [
  // Shown only when variations have different prices.
  '.single_variation .woocommerce-variation-price .woocommerce-Price-amount',
  // Otherwise WooCommerce keeps the main product price.
  '.summary p.price .woocommerce-Price-amount',
];

export const targets: Target[] = [
  // Group C: other products.
  {
    id: 'apollon-purifi-1et400a-st',
    name: 'Apollon Purifi 1ET400A ST Stereo Amplifier',
    retailer: 'Apollon Audio',
    url: 'https://apollonaudio.com/product/purifi-1et400a-st-stereo-amplifier-1993/',
    group: 'C',
    country: 'Slovenia',
    vat: 'excl',
    note: 'Base price, excluding EU VAT. Op-amp upgrades add €200 / €400; cover colour does not change the price.',
  },
  {
    id: 'apollon-purifi-1et6525sa-st',
    name: 'Apollon Purifi 1ET6525SA ST Stereo Amplifier',
    retailer: 'Apollon Audio',
    url: 'https://apollonaudio.com/product/purifi-eigentakt-1et6525sa-st-stereo-amplifier/',
    group: 'C',
    country: 'Slovenia',
    vat: 'excl',
    note: 'Base price, excluding EU VAT. Built to order (15-20 working days). Op-amp upgrades add €200 / €400; cover colour does not change the price.',
  },
  {
    // Successor to the discontinued LPA-S400ET (1ET400A).
    id: 'audiophonics-lpa-s450et',
    name: 'Audiophonics LPA-S450ET Purifi 1ET6525SA 2x450W',
    retailer: 'Audiophonics',
    url: 'https://www.audiophonics.fr/en/power-amplifiers/audiophonics-lpa-s450et-p-20206.html',
    group: 'C',
    country: 'France',
    vat: 'incl',
    note: 'Price includes VAT.',
  },
  {
    id: 'audiophonics-hpa-s450et',
    name: 'Audiophonics HPA-S450ET Purifi 1ET6525SA 2x450W',
    retailer: 'Audiophonics',
    url: 'https://www.audiophonics.fr/en/power-amplifiers/audiophonics-hpa-s450et-p-20205.html',
    group: 'C',
    country: 'France',
    vat: 'incl',
    note: 'Price includes VAT.',
  },
  {
    id: 'nord-three-1et6525sa-1et400a-std',
    name: 'Nord Three 1ET6525SA / 1ET400A STD Stereo Amplifier',
    retailer: 'Nord Acoustics',
    url: 'https://nordacoustics.co.uk/product/nord-three-1et6525sa-1et400a-std-standard-stereo-amplifier-copy/',
    group: 'C',
    country: 'UK',
    vat: 'incl',
    note: 'Base price with default options. Paid add-ons are listed in the README.',
  },
  {
    id: 'vtv-purifi-1et6525sa-stereo',
    name: 'VTV Stereo Purifi 1ET6525SA Amplifier',
    retailer: 'VTV Amplifier',
    url: 'https://vtvamplifier.com/product/vtv-amplifier-stereo-purifi-audio-1et-6525sa-amplifier-copy/',
    group: 'C',
    country: 'USA',
    vat: 'excl',
    priceFrom: true,
    note: 'Base price; input buffer, speaker terminal and 12V trigger options cost extra. 30-day trial.',
  },
  {
    id: 'buckeye-purifi-1et6525sa-2ch',
    name: 'Buckeye Purifi 1ET6525SA 2-Channel Amplifier',
    retailer: 'Buckeye Amps',
    url: 'https://www.buckeyeamp.com/shop/amplifiers/purifi/1et6525sa/2_channel',
    group: 'C',
    country: 'USA',
    vat: 'excl',
    // No structured data; the price is the bold line under the build-time notice.
    selectors: ['div.flex-col.items-center > div.font-bold'],
    note: 'Built to order (3–4 weeks). International buyers must contact them before ordering.',
  },
  {
    id: 'maroon-m6525-stereo',
    name: 'Maroon Audio M6525 Purifi 1ET6525SA Stereo Amplifier',
    retailer: 'Maroon Audio',
    url: 'https://maroonaudio.com/product/1et6525sa-purifi-stereo/',
    group: 'C',
    country: 'China',
    vat: 'excl',
    priceFrom: true,
    note: 'Standard Edition; the Luxury Edition is $1,600. Shipping $70; import VAT and duty are extra.',
  },

  // Group D: SVS SB-1000 Pro subwoofer, Black Ash (the gloss finishes cost £100 more).
  {
    id: 'homeavdirect-svs-sb1000pro-black-ash',
    name: 'SVS SB-1000 Pro Subwoofer, Black Ash',
    retailer: 'Home AV Direct',
    // A separate product page per colour.
    url: 'https://www.homeavdirect.co.uk/products/svs-sb-1000-pro-subwoofer-black-ash',
    group: 'D',
    country: 'UK',
    vat: 'incl',
  },
  {
    id: 'petertyson-svs-sb1000pro-black-ash',
    name: 'SVS SB-1000 Pro Subwoofer, Black Ash',
    retailer: 'Peter Tyson',
    // Despite the generic URL this is the Black Ash product (SKU SB1000PROBLK).
    url: 'https://petertyson.co.uk/svs-sb-1000-pro-subwoofer',
    group: 'D',
    country: 'UK',
    vat: 'incl',
  },
  {
    id: 'homemedia-svs-sb1000pro-black-ash',
    name: 'SVS SB-1000 Pro Subwoofer, Black Ash',
    retailer: 'Home Media',
    url: 'https://www.homemedialimited.co.uk/product/svs-sb-1000-pro-subwoofer/',
    group: 'D',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Black Ash',
      // The real <select> is hidden behind a visible copy; choose in the copy, then confirm.
      steps: [
        { action: 'select', selector: 'form.variations_form select:not(#pa_finish)', value: 'black-ash' },
        { action: 'expectValue', selector: 'select#pa_finish', value: 'black-ash' },
      ],
    },
    selectors: WOO_VARIATION_PRICE,
    stockSelector: '.single_variation .woocommerce-variation-availability',
  },
  {
    id: 'premiumsound-svs-sb1000pro-black-ash',
    name: 'SVS SB-1000 Pro Subwoofer, Black Ash',
    retailer: 'Premium Sound',
    url: 'https://premiumsound.co.uk/product/speakers/subwoofers/svs-sb1000-pro/',
    group: 'D',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Black Ash',
      // Colour radio buttons in front of a hidden <select>.
      steps: [
        { action: 'click', selector: 'label:has(input[type="radio"][value="black-ash"]), input[type="radio"][value="black-ash"]' },
        { action: 'expectValue', selector: 'select#pa_colour', value: 'black-ash' },
      ],
    },
    // The theme's own price block replaces WooCommerce's.
    selectors: ['#x-product-price p.price .woocommerce-Price-amount'],
    stockSelector: '.single_variation .woocommerce-variation-availability',
  },
  {
    id: 'nintronics-svs-sb1000pro-black-ash',
    name: 'SVS SB-1000 Pro Subwoofer, Black Ash',
    retailer: 'Nintronics',
    url: 'https://nintronics.co.uk/products/svs-sb-1000-pro-subwoofer',
    group: 'D',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Black Ash',
      steps: [{ action: 'select', selector: 'select[id^="Option-template"][id$="__main-0"]', value: 'Black Ash' }],
      // The page's JSON-LD names variants only by ID; this is the Black Ash one.
      offerMatch: 'variant=44233925066985',
    },
  },
];
