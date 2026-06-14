import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) {
    return null;
  }

  return (
    <div
      style={{
        backgroundColor: '#f4a261',
        color: '#fff',
        padding: '12px',
        textAlign: 'center',
        fontWeight: 'bold',
        zIndex: 100,
      }}
    >
      ⚠️ Offline Mode - Some features may be limited
    </div>
  );
}
