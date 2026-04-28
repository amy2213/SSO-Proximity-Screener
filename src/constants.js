export const EARTH_RADIUS_MI = 3959;
export const MAX_SITE_ROWS = 100;
export const CONFLICT_MI = 2.0;
export const CAUTION_MI = 2.5;

// Public USDA Rural Development MapServer URL (source name, kept verbatim).
// Layer 4 holds the agency's published polygons. This tool reports only whether
// a coordinate falls inside or outside those polygons as a neutral map fact;
// it does not make any determination about applications or programs.
export const USDA_RD_MAPSERVER_BASE =
  "https://rdgdwe.sc.egov.usda.gov/arcgis/rest/services/Eligibility/Eligibility/MapServer";
export const USDA_RD_LAYER_ID = 4;

export const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
export const GEOCODE_DELAY_MS = 200;

export const SITE_TYPES = ["Open", "Restricted Open", "Closed Enrolled", "Camp", "Other"];
export const SERVICE_MODELS = ["Congregate", "Non-Congregate", "Hybrid", "Unknown"];

export const LOCATION_TYPES = [
  "Street Address",
  "School",
  "Community Site",
  "Park/Public Facility",
  "Intersection",
  "Bus Stop",
  "Mobile Route Stop",
  "Manual Pin",
  "Other",
];

export const NOTE_TYPES = [
  "Address Check",
  "Coordinate Check",
  "Nearby Location",
  "Public Dataset Lookup",
  "Public Map Reference",
  "Manual Verification",
];

export const PAIR_STATUS = {
  WITHIN_2: "Within 2.0 mi",
  VERIFY: "Verify 2.0-2.5 mi",
  OK: "No proximity flag",
  MISSING: "Missing Data",
};

export const GLOBAL_DISCLAIMER =
  "This tool is for location screening and data quality support only. It does not determine application completeness, eligibility, approval, denial, waiver requirements, or compliance status. All official review actions must be completed in approved agency systems using current policy and supervisor guidance.";

export const TABS = [
  "Dashboard",
  "Site Workspace",
  "TDA Import",
  "Geocode & QA",
  "Nearby Sites",
  "Reference Maps",
  "Location Notes",
  "Data Sources",
];
