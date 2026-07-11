import {
  IonContent,
  IonPage,
} from '@ionic/react';
import { CloudStatusCard } from '../components/CloudStatusCard';
import { AppHeader } from '../components/AppHeader';

export function SystemPage() {
  return (
    <IonPage>
      <AppHeader title="System" subtitle="Diagnostics, connectivity and runtime status" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Runtime diagnostics</h2>
            <p className="text-sm text-muted mt-1">Cloud reachability and edge connectivity checks for operations.</p>
          </section>
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <CloudStatusCard />
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
