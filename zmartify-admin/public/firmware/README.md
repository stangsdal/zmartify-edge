# Firmwarebibliotek

Firmwarebiblioteket er den eneste kilde til controller-OTA og USB recovery. `releases.json` under hver controller bevarer alle publicerede versioner, mens `catalog.json` angiver den seneste release.

## Publicer HVAC firmware

Kør release-scriptet fra det relevante firmware-repository:

```bash
# AHC9000
cd /Users/peter/zmartify-hvac-ahc9000
source ~/.espressif/v6.0.1/esp-idf/export.sh
./ops/build_firmware_release.sh

# NILAN
cd /Users/peter/Dev/zmartify-hvac-nilan
source ~/.espressif/v6.0.1/esp-idf/export.sh
./ops/build_firmware_release.sh
```

Opdatér først `CONFIG_APP_PROJECT_VER` i `sdkconfig.defaults`. Scriptet bygger firmwaren, kontrollerer det kompilerede versionsnummer, genererer factory-imaget og kopierer både OTA app-imaget og USB recovery-imaget ind i biblioteket. Et allerede publiceret versionsnummer afvises.

## Tilføj en controller

1. Opret en mappe med controllerens stabile ID, eksempelvis `nilan/`.
2. Tilføj `index.html`, `manifest.json`, `SHA256SUMS` og `releases.json`.
3. Tilføj controllerens metadata, kompatibilitetsmønstre og relative filstier i `catalog.json`.
4. Kør `npm run firmware:validate` og `npm run build`.

ESP Web Tools-manifestet skal have præcis én build og mindst én part. Den første parts `path` er filen, som bibliotekets downloadknap anvender. `SHA256SUMS` skal indeholde SHA-256 for samme fil.

USB-manifestets første part er et factory/recovery-image og må ikke bruges til OTA. Hver version i `releases.json` deklarerer sine egne artefakter:

```json
{
	"version": "0.3.54",
	"ota": {
		"path": "zmartify-hvac-ahc9000-0.3.54.bin",
		"filename": "zmartify-hvac-ahc9000-0.3.54.bin",
		"sha256": "<64 lowercase hex characters>"
	},
	"recovery": {
		"path": "zmartify-hvac-ahc9000-0.3.54.factory.bin",
		"sha256": "<64 lowercase hex characters>"
	}
}
```

Build-validatoren kontrollerer alle arkiverede filer og checksums. Uden `ota` vises releasen fortsat i biblioteket, men OTA-staging er deaktiveret.

Erstat kun en publiceret firmware efter et versionsskift. Behold controllerens mappe-ID og katalogstier stabile, så eksisterende links fortsætter med at virke.