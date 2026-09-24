import type { Target } from './types';

/**
 * Matches the KEF S3 Floor Stand in Indigo Matte Special Edition in JSON-LD, by GTIN or KEF SKU
 * (retailers list one or the other).
 */
const KEF_S3_INDIGO = '637203049866|SP4062CA';

/** Price selectors for WooCommerce product pages after a variation has been chosen. */
const WOO_VARIATION_PRICE = [
  // Shown only when variations have different prices.
  '.single_variation .woocommerce-variation-price .woocommerce-Price-amount',
  // Otherwise WooCommerce keeps the main product price.
  '.summary p.price .woocommerce-Price-amount',
];

export const targets: Target[] = [
  // Group A: URLs that load the Indigo variant directly.
  {
    id: 'smarthomesounds-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Smart Home Sounds',
    url: 'https://www.smarthomesounds.co.uk/kef-s3-floor-stand-for-r3-indigo',
    group: 'A',
    country: 'UK',
    vat: 'incl',
  },
  {
    id: 'homeavdirect-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Home AV Direct',
    url: 'https://homeavdirect.co.uk/kef-s3-floor-stands-indigo',
    group: 'A',
    country: 'UK',
    vat: 'incl',
  },
  {
    id: 'hbh-woolacotts-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'HBH Woolacotts',
    url: 'https://www.hbh-woolacotts.co.uk/audio/S3STAND-IB',
    group: 'A',
    country: 'UK',
    vat: 'incl',
    note: 'Redirects to the clearance section.',
  },
  {
    id: 'petertyson-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Peter Tyson',
    // Despite the generic URL this is a single-colour "Indigo Blue" product (SKU KEFS3STDBLUE).
    url: 'https://petertyson.co.uk/kef-s3-floor-stands',
    group: 'A',
    country: 'UK',
    vat: 'incl',
  },

  // Group B: pages covering all colours; Indigo is selected before reading the price.
  {
    id: 'kef-uk-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'KEF UK',
    url: 'https://uk.kef.com/products/s3-floor-stand',
    group: 'B',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Indigo Matte Special Edition',
      steps: [
        { action: 'click', selector: 'label:has(input[value="Indigo Matte Special Edition"])' },
      ],
      offerMatch: KEF_S3_INDIGO,
    },
  },
  {
    id: 'weybridge-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Weybridge Audio',
    url: 'https://www.weybridge-audio.co.uk/products/kef-s3-speaker-stands',
    group: 'B',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Indigo Matte',
      steps: [{ action: 'select', selector: 'select[name="options[Finish]"]', value: 'Indigo Matte' }],
      offerMatch: KEF_S3_INDIGO,
    },
  },
  {
    id: 'audiolounge-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Audio Lounge',
    url: 'https://www.audiolounge.co.uk/kef-s3-stands',
    group: 'B',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Indigo',
      // The <select> is hidden behind swatch buttons, so click the swatch and confirm it registered.
      steps: [
        { action: 'click', selector: 'form.variations_form button[data-attribute-value="indigo"]' },
        { action: 'expectValue', selector: 'select#pa_colour', value: 'indigo' },
      ],
    },
    selectors: WOO_VARIATION_PRICE,
    stockSelector: '.single_variation .woocommerce-variation-availability',
  },
  {
    id: 'dougbrady-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Doug Brady HiFi',
    url: 'https://dougbradyhifi.com/products/kef-s3-floor-stand',
    group: 'B',
    country: 'UK',
    vat: 'incl',
    variant: {
      label: 'Indigo Blue',
      // A custom dropdown: open it, then choose the option.
      steps: [
        { action: 'click', selector: '.product-options .custom-select__btn' },
        { action: 'click', selector: 'li[data-value="Indigo Blue"]' },
      ],
      offerMatch: KEF_S3_INDIGO,
    },
  },
  {
    id: 'hifisound-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'HifiSound',
    url: 'https://www.hifisound.co.uk/speakers-c62/speaker-stands-c120/kef-s3-floor-stand-p6023',
    group: 'B',
    country: 'UK',
    vat: 'incl',
    note: 'Listed as "Gloss Indigo"; KEF only makes the S3 in Indigo Matte.',
    variant: {
      label: 'Gloss Indigo',
      steps: [{ action: 'select', selector: 'select.attributes-select', value: '1266' }],
    },
    selectors: ['#js-product-price .product-content__price--inc'],
  },

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
];
