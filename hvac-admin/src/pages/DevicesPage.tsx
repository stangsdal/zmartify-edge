import {
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
  IonPage,
} from '@ionic/react';

export function DevicesPage() {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Devices</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <p>Devices management - Phase 1</p>
      </IonContent>
    </IonPage>
  );
}
