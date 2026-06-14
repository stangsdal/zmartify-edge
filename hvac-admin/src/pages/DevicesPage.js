import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonList, IonItem, IonLabel, IonButton, IonCard, IonCardContent, IonInput, IonLoading, IonAlert, } from '@ionic/react';
import { deviceApi } from '../api/devices';
export function DevicesPage() {
    const [devices, setDevices] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newDeviceId, setNewDeviceId] = useState('');
    const [newDisplayName, setNewDisplayName] = useState('');
    const [newMac, setNewMac] = useState('');
    const [newFirmwareVersion, setNewFirmwareVersion] = useState('');
    const [creating, setCreating] = useState(false);
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const fetchDevices = async () => {
        try {
            setLoading(true);
            const data = await deviceApi.list();
            setDevices(data);
            setError('');
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        fetchDevices();
    }, []);
    const handleCreateDevice = async () => {
        if (!newDeviceId.trim() || !newDisplayName.trim()) {
            setError('Device ID and display name are required');
            return;
        }
        try {
            setCreating(true);
            await deviceApi.create(newDeviceId, newDisplayName, newMac || undefined, newFirmwareVersion || undefined);
            setNewDeviceId('');
            setNewDisplayName('');
            setNewMac('');
            setNewFirmwareVersion('');
            setShowForm(false);
            setError('');
            await fetchDevices();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleDeleteDevice = async (deviceId) => {
        try {
            setCreating(true);
            await deviceApi.delete(deviceId);
            setError('');
            await fetchDevices();
            setShowDeleteAlert(false);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "Devices" }) }) }), _jsxs(IonContent, { className: "ion-padding", children: [_jsx(IonLoading, { isOpen: creating, message: "Processing..." }), _jsx(IonAlert, { isOpen: showDeleteAlert, onDidDismiss: () => setShowDeleteAlert(false), header: "Confirm Delete", message: "Are you sure you want to delete this device?", buttons: [
                            { text: 'Cancel', role: 'cancel' },
                            {
                                text: 'Delete',
                                role: 'destructive',
                                handler: () => {
                                    if (deleteTarget !== null) {
                                        handleDeleteDevice(deleteTarget);
                                    }
                                },
                            },
                        ] }), error && (_jsx(IonCard, { children: _jsxs(IonCardContent, { style: { color: 'red' }, children: [_jsx("strong", { children: "Error:" }), " ", error] }) })), _jsx(IonButton, { expand: "block", onClick: () => setShowForm(!showForm), className: "ion-margin-bottom", children: showForm ? 'Cancel' : 'Register Device' }), showForm && (_jsx(IonCard, { className: "ion-margin-bottom", children: _jsxs(IonCardContent, { children: [_jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Device ID" }), _jsx(IonInput, { value: newDeviceId, onIonChange: (e) => setNewDeviceId(e.detail.value || ''), placeholder: "e.g., device-001" })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Display Name" }), _jsx(IonInput, { value: newDisplayName, onIonChange: (e) => setNewDisplayName(e.detail.value || ''), placeholder: "e.g., Office Thermostat" })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "MAC Address (optional)" }), _jsx(IonInput, { value: newMac, onIonChange: (e) => setNewMac(e.detail.value || ''), placeholder: "e.g., 00:11:22:33:44:55" })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Firmware Version (optional)" }), _jsx(IonInput, { value: newFirmwareVersion, onIonChange: (e) => setNewFirmwareVersion(e.detail.value || ''), placeholder: "e.g., 1.0.0" })] }), _jsx("div", { style: { marginTop: '16px', display: 'flex', gap: '8px' }, children: _jsx(IonButton, { expand: "block", onClick: handleCreateDevice, children: "Register" }) })] }) })), loading ? (_jsx("p", { children: "Loading devices..." })) : devices.length === 0 ? (_jsx("p", { children: "No devices registered yet." })) : (_jsx(IonList, { children: devices.map((device) => (_jsxs(IonItem, { children: [_jsxs(IonLabel, { children: [_jsx("strong", { children: device.display_name }), _jsx("p", { children: device.device_id }), device.mac && _jsxs("p", { children: ["MAC: ", device.mac] }), device.site_id && (_jsxs("p", { style: { color: '#666' }, children: ["Site ID: ", device.site_id] })), device.online !== undefined && (_jsx("p", { style: {
                                                color: device.online ? 'green' : 'red',
                                            }, children: device.online ? 'Online' : 'Offline' }))] }), _jsx(IonButton, { slot: "end", color: "danger", size: "small", onClick: () => {
                                        setDeleteTarget(device.device_id);
                                        setShowDeleteAlert(true);
                                    }, children: "Delete" })] }, device.device_id))) }))] })] }));
}
