import { IonButton, IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';

export function AutomationsPage() {
  const history = useHistory();

  return (
    <IonPage>
      <AppHeader title="Automations" subtitle="Schedules, programs and automation controls" />
      <IonContent className="ion-padding">
        <div className="space-y-4 pb-20 lg:pb-8">
          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">Irrigation programs</h2>
            <p className="text-sm text-muted mt-1">
              Manage sequential watering programs, weather adjustments and manual overrides.
            </p>
            <IonButton className="mt-3" onClick={() => history.push('/app/control/irrigation/programs')}>
              Open programs
            </IonButton>
          </section>

          <section className="rounded-2xl app-surface p-4 shadow-soft border border-slate-100">
            <h2 className="text-lg font-semibold">HVAC setpoint workflows</h2>
            <p className="text-sm text-muted mt-1">
              Configure room behavior patterns and monitor setpoint operations from Control and Insights.
            </p>
            <IonButton className="mt-3" fill="outline" onClick={() => history.push('/app/control/hvac/zones')}>
              Open HVAC zones
            </IonButton>
          </section>
        </div>
      </IonContent>
    </IonPage>
  );
}
