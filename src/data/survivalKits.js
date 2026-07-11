/**
 * Checklists de preparação civil (ids → chaves i18n).
 * Conteúdo offline — sem API.
 * @module data/survivalKits
 */

/** Kit base 72h — sempre relevante */
export const BASE_72H_KIT = [
  'surv_item_water',
  'surv_item_food',
  'surv_item_light',
  'surv_item_radio',
  'surv_item_first_aid',
  'surv_item_docs',
  'surv_item_powerbank',
  'surv_item_cash',
  'surv_item_clothes',
  'surv_item_whistle',
];

/**
 * @type {Record<string, { titleKey: string, items: string[] }>}
 */
export const SCENARIO_KITS = {
  heat: {
    titleKey: 'surv_kit_heat',
    items: [
      'surv_item_extra_water',
      'surv_item_shade',
      'surv_item_electrolytes',
      'surv_item_light_clothes',
      'surv_item_check_elderly',
    ],
  },
  cold: {
    titleKey: 'surv_kit_cold',
    items: [
      'surv_item_layers',
      'surv_item_dry_socks',
      'surv_item_blanket',
      'surv_item_hot_drink',
    ],
  },
  storm: {
    titleKey: 'surv_kit_storm',
    items: [
      'surv_item_indoor_shelter',
      'surv_item_unplug',
      'surv_item_secure_objects',
      'surv_item_avoid_trees',
    ],
  },
  flood_rain: {
    titleKey: 'surv_kit_flood',
    items: [
      'surv_item_high_ground',
      'surv_item_docs_waterproof',
      'surv_item_no_flood_drive',
      'surv_item_cut_power_flood',
      'surv_item_boots',
    ],
  },
  smoke: {
    titleKey: 'surv_kit_smoke',
    items: [
      'surv_item_mask_n95',
      'surv_item_close_windows',
      'surv_item_indoor_air',
      'surv_item_limit_outdoor',
    ],
  },
  fire_weather: {
    titleKey: 'surv_kit_fire_weather',
    items: [
      'surv_item_no_burn',
      'surv_item_water_near',
      'surv_item_clear_brush',
      'surv_item_monitor_fires',
    ],
  },
  wildfire: {
    titleKey: 'surv_kit_wildfire',
    items: [
      'surv_item_go_bag',
      'surv_item_evacuation_route',
      'surv_item_vehicle_fuel',
      'surv_item_family_meetup',
      'surv_item_listen_official',
    ],
  },
};
