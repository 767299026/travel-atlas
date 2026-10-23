# Third-party sources and notices

## Open Design layout primitives

`frontend/src/styles/prototype-layout.css` extracts the `@layer od-layout` layout primitives from the user-owned OpenDesign prototype. Its source HTML includes the notice:

> Derived from the Open Design mobile-app template (Apache-2.0).

The upstream Apache License 2.0 is included in [licenses/OpenDesign-Apache-2.0.txt](licenses/OpenDesign-Apache-2.0.txt). The remaining prototype styles, icons, and adapted view structures are inventoried in [docs/prototype-reuse.md](docs/prototype-reuse.md).

## OpenStreetMap and routing evidence

The geographic source data and derived samples in `docs/evidence/` are based on © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution, capture dates, upstream service details, and limitations are retained in each evidence directory's README and source response. These samples are planning references, not GPS recordings or verified travel routes.

## Package dependencies

Package versions are recorded in `package-lock.json`. Dependencies retain their respective upstream licenses. These notices do not assign a new license to the entire project.

## Community outdoor map and regional router

The optional Leaflet 1.9.4 renderer retains its upstream BSD-2-Clause license in the installed package. It loads OpenHikingMap tiles from OpenMaps.fr only after the user requests them. Visible map attribution includes OpenHikingMap, a donation link to the tile service, and OpenStreetMap contributors. Service conditions checked 2026-10-22 are linked in [M3.2 documentation](docs/m3-routing.md); tile hosting permission and underlying OSM data licensing are distinct.

BRouter 1.7.10 is installed locally from its official release, without committing its binaries or regional datasets. Its MIT license is retained in [licenses/BRouter-MIT.txt](licenses/BRouter-MIT.txt) and copied into the private installation. The original `hiking-mountain` profile is used unchanged. Regional routing data is based on © OpenStreetMap contributors under ODbL 1.0. Candidate provenance and GPX exports preserve this attribution; engine code licensing does not replace the data license.

## Footprint overview geography

The lightweight world geometry in `backend/assets/world.json` is derived from the Natural Earth 1:110m GeoJSON retained in the user-owned prototype. Natural Earth declares map data public domain: [terms](https://www.naturalearthdata.com/about/terms-of-use/), checked 2026-10-23. Required labels, identifiers, representative centers and rounded geometry are kept; these are reference regions, not navigation or survey data.

Domestic metadata and geometry use fixed DataV GeoAtlas endpoints and ignored local cache; their geometry dataset is not committed. Sources, snapshot counts and remaining formal-use verification are recorded in [footprints and pages](docs/footprints-and-pages.md). No prototype photographs, sample trips or simulated visits are imported.

## Reference atlas renderer

The China, province and world reference atlas reuses the existing Leaflet 1.9.4 Canvas renderer (BSD-2-Clause). GeoJSON source attribution remains visible below the map. This reference renderer fetches no background tile service; OpenHikingMap is used only by the separate outdoor view described above. See [mobile rendering notes](docs/mobile-map-rendering.md).

## Reference atlas label anchors

Administrative names use [Mapbox polylabel](https://github.com/mapbox/polylabel) 2.1.0 to choose an interior point of the largest polygon component in Web Mercator. The anchor is computed once per feature; recorded visits retain their original coordinates. The package and its tinyqueue 3.0.0 dependency use ISC licenses, retained in [polylabel](licenses/polylabel-ISC.txt) and [tinyqueue](licenses/tinyqueue-ISC.txt). Checked 2026-10-23; exact versions are in the lockfile.
