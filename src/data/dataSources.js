export const DATA_SOURCES = [
  {
    name: "TDA SNP Socrata dataset (3qgy-p3sr)",
    purpose:
      "Texas Department of Agriculture School Nutrition Programs site data. Future ingestion as a reference list of locations that have appeared in the public dataset.",
    status: "Planned Phase 3",
    caveat:
      "Public dataset content and refresh cadence may lag operational records. Used only as a public reference, never as an authoritative roster.",
  },
  {
    name: "U.S. Census Geocoder",
    purpose:
      "Resolve street addresses to latitude/longitude (Public_AR_Current benchmark) so coordinates can be screened on a map.",
    status: "Planned Phase 2",
    caveat:
      "Census matching may not resolve bus stops, intersections, informal pickup points, PO boxes, or ambiguous rural locations accurately. Always inspect Needs Review, No Match, and Error results manually.",
  },
  {
    name: "USDA RD Eligibility MapServer (Layer 4)",
    purpose:
      "Public reference for whether a coordinate falls inside USDA Rural Development's published RHS SFH/MFH ineligible-area polygons.",
    status: "Active reference",
    caveat:
      "Inside/Outside the polygon is a neutral location fact about the published map. It is not an eligibility, approval, denial, or waiver determination.",
  },
  {
    name: "TDA Summer Sites dataset",
    purpose:
      "Future reference catalog of summer meal site locations for cross-checking historic locations.",
    status: "Future",
    caveat:
      "Not yet integrated. Schema, refresh cadence, and naming conventions will need to be confirmed at integration time.",
  },
  {
    name: "Census TIGERweb",
    purpose:
      "Future reference for jurisdictional and statistical geography boundaries (places, tracts, school districts).",
    status: "Future",
    caveat:
      "Not yet integrated. Used only as a neutral location reference; boundary data is not a programmatic determination.",
  },
];

export const REFERENCE_NOTES = [
  {
    title: "Distance Method",
    body:
      "Haversine formula using Earth radius = 3,959 miles. This gives straight-line great-circle distance, not road distance.",
  },
  {
    title: "Proximity Bands",
    body:
      "Within 2.0 mi: pair is closer than 2.0 miles straight-line.\nVerify 2.0-2.5 mi: pair is between 2.0 and 2.5 miles straight-line; review with public maps.\nNo proximity flag: pair is 2.5 miles or further apart.\nThese bands are screening labels only, not eligibility decisions.",
  },
  {
    title: "Location Data Flags",
    body:
      "Missing Coordinates: latitude or longitude blank.\nInvalid Coordinates: latitude or longitude outside valid bounds.\nPossible Duplicate Address: two or more locations share the same normalized address.\nPossible Duplicate Coordinates: two or more locations share the same lat/lon.\nShared CE: both locations in a pair list the same Contracting Entity.",
  },
  {
    title: "CSV Format",
    body:
      "Preferred headers: Site ID, CE Name, Site Name, Street Address, City, State, ZIP, Latitude, Longitude, Site Type, Service Model, Mobile Route Stop, Location Type, Source, Source Dataset, Source Dataset ID, Source Record ID, Imported At, Coordinate Source, Notes.",
  },
];
