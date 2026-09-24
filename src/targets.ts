import type { Target } from './types';

/** GTIN of the KEF S3 Floor Stand in Indigo Matte Special Edition (KEF SKU SP4062CA). */
const KEF_S3_INDIGO_GTIN = '637203049866';

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
  },
  {
    id: 'homeavdirect-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Home AV Direct',
    url: 'https://homeavdirect.co.uk/kef-s3-floor-stands-indigo',
    group: 'A',
  },
  {
    id: 'hbh-woolacotts-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'HBH Woolacotts',
    url: 'https://www.hbh-woolacotts.co.uk/audio/S3STAND-IB',
    group: 'A',
    note: 'Redirects to the clearance section.',
  },
  {
    id: 'petertyson-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Peter Tyson',
    // Despite the generic URL this is a single-colour "Indigo Blue" product (SKU KEFS3STDBLUE).
    url: 'https://petertyson.co.uk/kef-s3-floor-stands',
    group: 'A',
  },

  // Group B: pages covering all colours; Indigo is selected before reading the price.
  {
    id: 'kef-uk-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'KEF UK',
    url: 'https://uk.kef.com/products/s3-floor-stand',
    group: 'B',
    variant: {
      label: 'Indigo Matte Special Edition',
      steps: [
        { action: 'click', selector: 'label:has(input[value="Indigo Matte Special Edition"])' },
      ],
      offerMatch: KEF_S3_INDIGO_GTIN,
    },
  },
  {
    id: 'weybridge-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Weybridge Audio',
    url: 'https://www.weybridge-audio.co.uk/products/kef-s3-speaker-stands',
    group: 'B',
    variant: {
      label: 'Indigo Matte',
      steps: [{ action: 'select', selector: 'select[name="options[Finish]"]', value: 'Indigo Matte' }],
      offerMatch: KEF_S3_INDIGO_GTIN,
    },
  },
  {
    id: 'audiolounge-kef-s3-indigo',
    name: 'KEF S3 Floor Stands, Indigo Matte SE (pair)',
    retailer: 'Audio Lounge',
    url: 'https://www.audiolounge.co.uk/kef-s3-stands',
    group: 'B',
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

  // Group C: other products.
  {
    id: 'apollon-purifi-1et400a-st',
    name: 'Apollon Purifi 1ET400A ST Stereo Amplifier',
    retailer: 'Apollon Audio',
    url: 'https://apollonaudio.com/product/purifi-1et400a-st-stereo-amplifier-1993/',
    group: 'C',
    note: 'Base price, excluding EU VAT. Op-amp upgrades add €200 / €400; cover colour does not change the price.',
  },
  {
    // Successor to the discontinued LPA-S400ET (1ET400A).
    id: 'audiophonics-lpa-s450et',
    name: 'Audiophonics LPA-S450ET Purifi 1ET6525SA 2x450W',
    retailer: 'Audiophonics',
    url: 'https://www.audiophonics.fr/en/power-amplifiers/audiophonics-lpa-s450et-p-20206.html',
    group: 'C',
    note: 'Price includes VAT.',
  },
  {
    id: 'nord-three-1et6525sa-1et400a-std',
    name: 'Nord Three 1ET6525SA / 1ET400A STD Stereo Amplifier',
    retailer: 'Nord Acoustics',
    url: 'https://nordacoustics.co.uk/product/nord-three-1et6525sa-1et400a-std-standard-stereo-amplifier-copy/',
    group: 'C',
    note: 'Base price with default options. Paid add-ons are listed in the README.',
  },
];
