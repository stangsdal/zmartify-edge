import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonList, IonItem, IonLabel, IonButton, IonCard, IonCardContent, IonLoading, IonAlert, } from '@ionic/react';
import { mqttClientApi } from '../api/mqttClients';
import { domainApi } from '../api/domains';
export function MqttClientsPage() {
    const [clients, setClients] = useState([]);
    const [domains, setDomains] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [selectedDomainId, setSelectedDomainId] = useState('');
    const [creating, setCreating] = useState(false);
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [showPasswordAlert, setShowPasswordAlert] = useState(false);
    const [passwordAlertMessage, setPasswordAlertMessage] = useState('');
    const [showAclAlert, setShowAclAlert] = useState(false);
    const [aclPreview, setAclPreview] = useState(null);
    const fetchClients = async () => {
        try {
            setLoading(true);
            const data = await mqttClientApi.list();
            setClients(data);
            setError('');
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setLoading(false);
        }
    };
    const fetchDomains = async () => {
        try {
            const data = await domainApi.list();
            setDomains(data);
        }
        catch (e) {
            console.error('Failed to fetch domains:', e);
        }
    };
    useEffect(() => {
        fetchClients();
        fetchDomains();
    }, []);
    const handleCreateHomeyClient = async () => {
        if (!selectedDomainId) {
            setError('Please select a domain');
            return;
        }
        try {
            setCreating(true);
            await mqttClientApi.createHomey(parseInt(selectedDomainId));
            setSelectedDomainId('');
            setShowForm(false);
            setError('');
            await fetchClients();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleRotatePassword = async (clientId) => {
        try {
            setCreating(true);
            const response = await mqttClientApi.rotatePassword(clientId);
            setPasswordAlertMessage(`New password: ${response.password}`);
            setShowPasswordAlert(true);
            setError('');
            await fetchClients();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handlePreviewAcl = async (clientId) => {
        try {
            setCreating(true);
            const preview = await mqttClientApi.getAclPreview(clientId);
            setAclPreview(preview);
            setShowAclAlert(true);
            setError('');
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleRegenerateAcl = async () => {
        try {
            setCreating(true);
            await mqttClientApi.regenerateAcl();
            setError('ACL regenerated successfully');
            await fetchClients();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleDeleteClient = async (clientId) => {
        try {
            setCreating(true);
            await mqttClientApi.delete(clientId);
            setError('');
            await fetchClients();
            setShowDeleteAlert(false);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "MQTT Clients" }) }) }), _jsxs(IonContent, { className: "ion-padding", children: [_jsx(IonLoading, { isOpen: creating, message: "Processing..." }), _jsx(IonAlert, { isOpen: showDeleteAlert, onDidDismiss: () => setShowDeleteAlert(false), header: "Confirm Delete", message: "Are you sure you want to delete this MQTT client?", buttons: [
                            { text: 'Cancel', role: 'cancel' },
                            {
                                text: 'Delete',
                                role: 'destructive',
                                handler: () => {
                                    if (deleteTarget !== null) {
                                        handleDeleteClient(deleteTarget);
                                    }
                                },
                            },
                        ] }), _jsx(IonAlert, { isOpen: showPasswordAlert, onDidDismiss: () => setShowPasswordAlert(false), header: "Password Rotated", message: passwordAlertMessage, buttons: ['OK'] }), aclPreview && (_jsx(IonAlert, { isOpen: showAclAlert, onDidDismiss: () => setShowAclAlert(false), header: "ACL Preview", message: `Client: ${aclPreview.client_id}\n\nRules:\n${aclPreview.rules.join('\n')}`, buttons: ['OK'] })), error && (_jsx(IonCard, { children: _jsxs(IonCardContent, { style: { color: 'red' }, children: [_jsx("strong", { children: "Status:" }), " ", error] }) })), _jsxs("div", { className: "ion-margin-bottom", children: [_jsx(IonButton, { expand: "block", onClick: () => setShowForm(!showForm), className: "ion-margin-bottom", children: showForm ? 'Cancel' : 'Create Homey Client' }), _jsx(IonButton, { expand: "block", onClick: handleRegenerateAcl, color: "warning", children: "Regenerate ACL" })] }), showForm && (_jsx(IonCard, { className: "ion-margin-bottom", children: _jsxs(IonCardContent, { children: [_jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Domain" }), _jsxs("select", { value: selectedDomainId, onChange: (e) => setSelectedDomainId(e.target.value), style: {
                                                width: '100%',
                                                padding: '8px',
                                                borderRadius: '4px',
                                                border: '1px solid #ccc',
                                            }, children: [_jsx("option", { value: "", children: "Select a domain..." }), domains.map((domain) => (_jsxs("option", { value: domain.id, children: [domain.name, " (", domain.slug, ")"] }, domain.id)))] })] }), _jsx("div", { style: { marginTop: '16px', display: 'flex', gap: '8px' }, children: _jsx(IonButton, { expand: "block", onClick: handleCreateHomeyClient, children: "Create" }) })] }) })), loading ? (_jsx("p", { children: "Loading MQTT clients..." })) : clients.length === 0 ? (_jsx("p", { children: "No MQTT clients yet." })) : (_jsx(IonList, { children: clients.map((client) => (_jsxs(IonItem, { children: [_jsxs(IonLabel, { children: [_jsx("strong", { children: client.client_id }), _jsxs("p", { children: ["Type: ", client.client_type] }), _jsxs("p", { children: ["Username: ", client.username] }), _jsxs("p", { children: ["Status: ", client.enabled ? 'Enabled' : 'Disabled'] }), client.last_rotated && (_jsxs("p", { style: { fontSize: '0.8em', color: '#666' }, children: ["Last rotated: ", client.last_rotated] }))] }), _jsxs("div", { slot: "end", style: {
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                    }, children: [client.client_type === 'homey' && (_jsxs(_Fragment, { children: [_jsx(IonButton, { size: "small", fill: "outline", onClick: () => handleRotatePassword(client.id), children: "Rotate" }), _jsx(IonButton, { size: "small", fill: "outline", onClick: () => handlePreviewAcl(client.client_id), children: "ACL" })] })), _jsx(IonButton, { size: "small", color: "danger", fill: "outline", onClick: () => {
                                                setDeleteTarget(client.id);
                                                setShowDeleteAlert(true);
                                            }, children: "Delete" })] })] }, client.id))) }))] })] }));
}
