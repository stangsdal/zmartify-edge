import { IonItem, IonLabel, IonSelect, IonSelectOption } from '@ionic/react';

interface SiteOption {
  site_id: string;
  site_name: string;
}

interface SiteSelectorProps {
  label?: string;
  options: SiteOption[];
  value?: string;
  onChange: (siteId: string) => void;
}

export function SiteSelector({ label = 'Property', options, value, onChange }: SiteSelectorProps) {
  return (
    <IonItem className="rounded-2xl overflow-hidden app-surface shadow-soft">
      <IonLabel>{label}</IonLabel>
      <IonSelect value={value} onIonChange={(e) => onChange(String(e.detail.value))} interface="popover">
        {options.map((site) => (
          <IonSelectOption key={site.site_id} value={site.site_id}>
            {site.site_name}
          </IonSelectOption>
        ))}
      </IonSelect>
    </IonItem>
  );
}
