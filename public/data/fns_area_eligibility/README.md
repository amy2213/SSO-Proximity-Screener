# FNS Area Eligibility Data (Site Signal)

This folder holds Texas-only extracts of USDA Food and Nutrition Service (FNS)
Area Eligibility data, keyed by 12-digit Census Block Group GEOID. Site Signal
joins a workspace site's `censusBlockGroupGEOID` to a row in the active CSV
and surfaces the FNS-published flags and percentages **as a public-data
reference only**. Site Signal does not compute area eligibility from raw ACS
variables and does not make eligibility, approval, denial, waiver, or
compliance decisions.

## Authoritative source

USDA-FNS publishes annual Area Eligibility data on its open-data hub:

- Hub: https://usda-fns.hub.arcgis.com/
- Latest item (FY26):
  https://usda-fns.hub.arcgis.com/datasets/USDA-FNS::participants-eligible-for-free-and-reduced-price-fy-26/about
- About area eligibility:
  https://www.fns.usda.gov/cacfp/about-area-eligibility
- Texas Department of Agriculture guidance:
  https://squaremeals.org/FandN-Resources/Census-Data

Each FY's release is derived from a special tabulation of American Community
Survey data produced by FNS. Operators should always read FNS's published
flag, never re-compute it from ACS.

## Files in this folder

| File | Purpose |
| --- | --- |
| `fy26_TX_sample.csv` | Small hand-curated **sample** for development and demos. **Do not use for any real review.** |
| `fy26_TX.csv` *(optional)* | Real Texas extract of the FY26 file. Site Signal loads this when present and falls back to the sample if it is missing. |

The loader (`src/utils/areaEligibility.js`) tries `fy26_TX.csv` first and
falls back to `fy26_TX_sample.csv`. Older fiscal years follow the same naming
pattern: `fy25_TX.csv`, `fy24_TX.csv`, etc. The 5-year area-eligibility
re-determination rule means historical FY files remain operationally relevant.

## Schema (all files in this folder)

CSV with the following header row:

```
GEOID,County Name,State Name,SFSP Eligible,CACFP Eligible,SFSP Percent,CACFP Percent,Source FY,Source Name,Source URL
```

| Column | Type | Notes |
| --- | --- | --- |
| `GEOID` | string | **12-digit** Census Block Group GEOID (state 2 + county 3 + tract 6 + block group 1). Keep leading zeros — open the CSV with all fields formatted as text. |
| `County Name` | string | e.g. `Travis County` |
| `State Name` | string | `TX` for the Texas extract |
| `SFSP Eligible` | `Y` / `N` | FNS-published flag for SFSP. `Y` means the FNS file marks this CBG as meeting the 50% threshold for SFSP / SSO. |
| `CACFP Eligible` | `Y` / `N` | FNS-published flag for CACFP day-care homes. |
| `SFSP Percent` | number 0-100 | Percent of SFSP-age children eligible for free or reduced-price meals, per FNS. |
| `CACFP Percent` | number 0-100 | Percent of CACFP-age children eligible for free or reduced-price meals, per FNS. |
| `Source FY` | string | e.g. `FY26` for the official file, `FY26 (sample)` for the sample. |
| `Source Name` | string | e.g. `USDA-FNS Area Eligibility (FY26)`. |
| `Source URL` | string | Link back to the FNS hub item the row was extracted from. |

## How to refresh with the real Texas file

1. Open the latest FY item on the FNS ArcGIS Hub (URL above).
2. Download the layer as CSV (or query the FeatureServer with `where=STATE='48'`).
3. Re-shape to the schema above (12-digit GEOID, `Y`/`N` flags, numeric
   percents). When opening in Excel, format every column as `Text` first or
   leading zeros on the GEOID will be silently dropped.
4. Save as `fy26_TX.csv` next to this README.
5. Commit; rebuild. The loader will pick up the real file automatically and
   ignore `fy26_TX_sample.csv` until the real file is removed.

## Caveats

- The sample file is for wiring/QA only. Do not rely on the values.
- FNS item names and FeatureServer URLs change between fiscal years; always
  re-confirm the source URL before refreshing.
- The 5-year area-eligibility re-determination rule means a site established
  in (say) FY22 must be compared against the FY22 file — keep historical files
  in this folder if you need them.
- Site Signal remains a public-data QA / proximity reference tool. It
  surfaces the FNS-published flag as a neutral data point and explicitly does
  not determine application completeness, eligibility, approval, denial,
  waiver requirements, or compliance status.
