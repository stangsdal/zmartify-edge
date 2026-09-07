# Onboarding af Zmartify AHC9000-controller

Denne manual beskriver installation uden lokal IP-adresse, port forwarding eller adgang fra Zmartify Edge til kundens LAN. ESPTouch V2 bruges kun til at give controlleren Wi-Fi-oplysninger og en sekscifret engangskode. Resten udføres i `app.zmartify.dk`.

## Forudsætninger

- En Zmartify AHC9000-controller med firmware, der understøtter ESPTouch V2 og outbound bootstrap.
- En computer med Chrome eller Edge og et USB-datakabel til at aflæse controllerens identitet.
- En telefon på kundens 2,4 GHz Wi-Fi.
- Wi-Fi-navn og adgangskode.
- Espressifs ESPTouch-app med **ESPTouch V2** og feltet **Custom Data**.
- Adgang til `https://app.zmartify.dk` som minimum site-owner på den valgte installation.
- Kundens netværk tillader DNS samt udgående HTTPS til `api.zmartify.dk` på TCP 443 og MQTT over TLS til `mqtt.zmartify.dk` på TCP 8883.

Der kræves ingen indgående firewallregel, offentlig IP-adresse, lokal controller-URL eller forbindelse mellem Zmartify Edge og kundens LAN.

## 1. Aflæs controllerens identitet via USB

1. Åbn `https://app.zmartify.dk/app/firmware/ahc9000/index.html` i Chrome eller Edge på en computer.
2. Afbryd controllerens eksterne strøm. USB og terminalforsyning må ikke være tilsluttet samtidigt.
3. Forbind controllerens USB-C-port direkte til computeren med et USB-datakabel.
4. Vælg **Læs controller-ID**, vælg controllerens USB-port og klik **Connect**.
5. Kopiér den viste MAC-adresse eller det fulde enheds-ID til onboarding.
6. Fjern USB-kablet, og tilslut controllerens normale strømforsyning.

**Læs controller-ID** aflæser den permanente MAC-adresse fra ESP32-S3 og frigiver USB-porten bagefter. Handlingen installerer ikke firmware og sletter ingen konfiguration. Hvis controlleren har en tydelig mærkat med MAC-adressen, kan den bruges i stedet.

## 2. Klargør controlleren i Zmartify

1. Tænd controlleren.
2. Åbn `https://app.zmartify.dk` og log ind.
3. Åbn **Onboarding**.
4. Indsæt controllerens aflæste MAC-adresse, for eksempel `AA:BB:CC:DD:EE:FF`. Det fulde enheds-ID kan også bruges.
5. Kontrollér eller ret controllerens navn.
6. Vælg domæne og installation.
7. Notér den viste sekscifrede claim-kode.
8. Vælg **Stage controller**.

Koden er knyttet til controlleren og installationen, udløber efter 10 minutter og kan kun indløses én gang. Fortsæt straks med ESPTouch.

## 3. Forbind controlleren med ESPTouch V2

1. Kontrollér, at telefonen er forbundet til kundens 2,4 GHz Wi-Fi.
2. Åbn Espressifs ESPTouch-app.
3. Vælg **ESPTouch V2**, ikke den ældre ESPTouch-protokol.
4. Kontrollér Wi-Fi-navnet og indtast Wi-Fi-adgangskoden.
5. Sæt antal enheder til `1`, hvis feltet vises.
6. Indtast claim-koden fra Zmartify i **Custom Data**.
7. Lad AES-nøglen være tom og kryptering være deaktiveret.
8. Start provisioning og vent på succesbeskeden. Det kan tage op til 90 sekunder.

Luk ikke Zmartify-siden. Controlleren forbinder nu selv udgående til Zmartify, henter individuelle MQTT-oplysninger via HTTPS og forbinder til MQTT med TLS.

## 4. Kontrollér resultatet

Gå tilbage til Zmartify-siden. Status opdateres automatisk.

Onboarding er gennemført, når siden viser:

- **Online: Yes**
- **MQTT Connected: Yes**

Det kan tage 1-2 minutter efter ESPTouch-succes, før controller- og AHC9000-data er synlige. En online controller uden zonedata er et separat Modbus/AHC9000-problem og betyder ikke, at onboarding er fejlet.

## Genforsøg

### ESPTouch finder ikke controlleren

- Kontrollér, at **ESPTouch V2** er valgt.
- Kontrollér, at telefonen bruger 2,4 GHz Wi-Fi. Deaktivér midlertidigt mobildata eller VPN, hvis provisioning ikke starter.
- Bliv tæt på controlleren og access pointet.
- Kontrollér Wi-Fi-adgangskoden.
- Start ESPTouch igen med præcis samme sekscifrede kode, mens staging stadig er gyldig.

### ESPTouch lykkes, men Zmartify venter fortsat

- Kontrollér, at **Custom Data** indeholdt præcis de seks cifre fra Zmartify.
- Kontrollér controllerens MAC/device-id i Zmartify.
- Vent mindst 90 sekunder og vælg derefter **Refresh status**.
- Kontrollér, at netværket tillader DNS, TCP 443 til `api.zmartify.dk` og TCP 8883 til `mqtt.zmartify.dk`.
- Hvis koden er udløbet, start onboarding igen i Zmartify og brug den nye kode i ESPTouch V2.

### Forkert installation eller controller-id

Start en ny onboarding i Zmartify med korrekt MAC/enheds-ID og installation. En eksisterende controller kræver owner-rettighed på både den nuværende og den nye installation.

### Controlleren skal flyttes til et andet Wi-Fi

Brug **AHC9000 USB Recovery**:

1. Åbn firmwarebiblioteket på `https://app.zmartify.dk/app/firmware/index.html` i Chrome eller Edge på en computer, og vælg Zmartify AHC9000.
2. Afbryd controllerens eksterne strøm. USB og terminalforsyning må ikke være tilsluttet samtidigt.
3. Forbind controlleren til computeren med et USB-datakabel.
4. Vælg **Læs controller-ID**, vælg controllerens USB-port, og kopiér MAC-adressen eller enheds-ID'et.
5. Vælg **Installer recovery-firmware**, vælg den samme USB-port igen, og bekræft sletning/installering.
6. Fjern USB efter installationen, tilslut normal strøm og begynd onboarding forfra med det kopierede ID.

Recovery-installationen sletter Wi-Fi, MQTT-oplysninger og onboarding fra NVS. En normal OTA-opdatering bevarer disse oplysninger.

Hvis USB-porten ikke vises, hold **BOOT** inde, tryk kort på **RESET**, slip RESET og slip derefter BOOT. Prøv installationen igen. På macOS kan Waveshares CH34x-driver være nødvendig.

## Oplysninger til support

Notér følgende uden at sende Wi-Fi-adgangskode eller claim-kode:

- Controllerens MAC-adresse og device-id.
- Valgt installation.
- Tidspunkt for forsøget.
- ESPTouch-resultatet.
- Status for **Online** og **MQTT Connected**.
- Om netværket tillader TCP 443 og 8883 til Zmartifys offentlige endpoints.

MQTT-adgangskode, device-admin-token og andre credentials må aldrig kopieres fra controlleren eller backendens logs.
