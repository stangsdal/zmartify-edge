import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
} from '@ionic/react';

export function SystemPage() {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>System</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p>System diagnostics - Phase 1</p>
      </IonContent>
    </IonPage>
  );
}
