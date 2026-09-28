import { IonContent, IonPage } from '@ionic/react';

export function PrivacyPage() {
  return (
    <IonPage>
      <IonContent className="ion-padding">
        <main className="mx-auto max-w-3xl space-y-8 py-8 text-slate-900">
          <header className="space-y-3 border-b border-slate-200 pb-6">
            <p className="text-sm font-semibold uppercase text-emerald-700">Zmartify HVAC</p>
            <h1 className="text-3xl font-bold">Privatlivspolitik</h1>
            <p className="text-sm text-slate-600">Senest opdateret 28. september 2026</p>
          </header>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Dataansvarlig</h2>
            <p>
              Zmartify ved Peter Kristian Kristensen er dataansvarlig for behandlingen af
              personoplysninger i Zmartify HVAC. Kontakt: <a className="text-emerald-700 underline" href="mailto:peter@zmartify.com">peter@zmartify.com</a>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Oplysninger vi behandler</h2>
            <p>Afhængigt af de funktioner du bruger, kan appen behandle:</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Konto- og kontaktoplysninger, roller og tilknytning til lokationer.</li>
              <li>Lokations-, zone-, anlægs- og enhedsoplysninger samt dine indstillinger.</li>
              <li>Drifts- og sensordata, herunder temperatur, HVAC-, vandings- og vejrdata.</li>
              <li>Tekniske hændelser og logdata, der bruges til sikkerhed og fejlfinding.</li>
            </ul>
            <p>
              Kameraet bruges kun til scanning af opsætningskoder. Bluetooth og adgang til det
              lokale netværk bruges til at finde og konfigurere kompatible enheder. Disse
              tilladelser bruges ikke til annoncering eller profilering.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Formål og behandlingsgrundlag</h2>
            <p>
              Oplysningerne bruges til at oprette og sikre din konto, vise og styre tilknyttede
              anlæg, levere vejrbaserede funktioner, gennemføre enhedsopsætning samt yde support
              og fejlfinding. Behandlingen er nødvendig for at levere tjenesten og varetage vores
              legitime interesse i sikker og stabil drift.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Deling og opbevaring</h2>
            <p>
              Vi sælger ikke personoplysninger og bruger dem ikke til tredjepartsannoncering.
              Oplysninger kan behandles af tekniske leverandører, når det er nødvendigt for
              hosting, vejrdata, sikkerhed og drift. Leverandører må kun behandle oplysningerne
              efter vores instrukser og med passende sikkerhedsforanstaltninger.
            </p>
            <p>
              Oplysninger opbevares, så længe din konto eller tilknytning til en lokation er
              aktiv, og derefter kun så længe det er nødvendigt af hensyn til sikkerhed,
              dokumentation eller lovkrav.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Dine rettigheder</h2>
            <p>
              Du kan anmode om indsigt, rettelse, sletning, begrænsning eller dataportabilitet og
              gøre indsigelse mod behandling. Kontakt os på adressen ovenfor. Du kan også klage
              til Datatilsynet, hvis du mener, at dine oplysninger behandles i strid med reglerne.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">Sikkerhed og ændringer</h2>
            <p>
              Vi anvender adgangskontrol, krypteret transport og andre tekniske og organisatoriske
              foranstaltninger. Politikken kan blive opdateret, når appens funktioner eller
              lovkrav ændres. Den gældende version vil altid være tilgængelig på denne side.
            </p>
          </section>
        </main>
      </IonContent>
    </IonPage>
  );
}
