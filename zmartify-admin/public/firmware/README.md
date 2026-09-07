# Firmwarebibliotek

`index.html` viser den seneste publicerede firmware for alle understøttede controllere. Versionsnummer, binærfil og checksum læses fra controllerens egne releasefiler, så de ikke duplikeres i kataloget.

## Tilføj en controller

1. Opret en mappe med controllerens stabile ID, eksempelvis `nilan/`.
2. Tilføj `index.html`, `manifest.json`, `SHA256SUMS` og den frigivne firmwarefil.
3. Tilføj controllerens metadata og relative filstier i `catalog.json`.
4. Kør `npm run firmware:validate` og `npm run build`.

ESP Web Tools-manifestet skal have præcis én build og mindst én part. Den første parts `path` er filen, som bibliotekets downloadknap anvender. `SHA256SUMS` skal indeholde SHA-256 for samme fil.

Erstat kun en publiceret firmware efter et versionsskift. Behold controllerens mappe-ID og katalogstier stabile, så eksisterende links fortsætter med at virke.