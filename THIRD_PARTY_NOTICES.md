# Third-party sources and notices

## Open Design layout primitives

`frontend/src/styles/prototype-layout.css` extracts the `@layer od-layout` layout primitives from the user-owned OpenDesign prototype. Its source HTML includes the notice:

> Derived from the Open Design mobile-app template (Apache-2.0).

The upstream Apache License 2.0 is included in [licenses/OpenDesign-Apache-2.0.txt](licenses/OpenDesign-Apache-2.0.txt). The remaining prototype styles, icons, and adapted view structures are inventoried in [docs/prototype-reuse.md](docs/prototype-reuse.md).

## OpenStreetMap and routing evidence

The geographic source data and derived samples in `docs/evidence/` are based on © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution, capture dates, upstream service details, and limitations are retained in each evidence directory's README and source response. These samples are planning references, not GPS recordings or verified travel routes.

## Package dependencies

Package versions are recorded in `package-lock.json`. Dependencies retain their respective upstream licenses. These notices do not assign a new license to the entire project.
