import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonCard, IonCardContent, } from '@ionic/react';
import { systemApi } from '../api/system';
export function DashboardPage() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => {
        (async () => {
            try {
                const data = await systemApi.getStatus();
                setStatus(data);
                setError('');
            }
            catch (e) {
                setError(String(e));
            }
        })();
    }, []);
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "Dashboard" }) }) }), _jsxs(IonContent, { className: "ion-padding", children: [error && _jsx("p", { style: { color: 'red' }, children: error }), !status ? (_jsx("p", { children: "Loading..." })) : (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }, children: [_jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Health" }), _jsx("p", { children: status.health })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Registry" }), _jsx("p", { children: status.registry_status })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "ACL File" }), _jsx("p", { children: status.acl_file_status })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Domains" }), _jsx("p", { children: status.domain_count })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Sites" }), _jsx("p", { children: status.site_count })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Devices" }), _jsx("p", { children: status.device_count })] }) }), _jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "MQTT Clients" }), _jsx("p", { children: status.mqtt_client_count })] }) }), status.last_acl_generation && (_jsx(IonCard, { children: _jsxs(IonCardContent, { children: [_jsx("strong", { children: "Last ACL Gen" }), _jsx("p", { children: status.last_acl_generation })] }) }))] }))] })] }));
}
