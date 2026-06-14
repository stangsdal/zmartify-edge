import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonList, IonItem, IonLabel, IonButton, IonCard, IonCardContent, IonInput, IonLoading, IonAlert, } from '@ionic/react';
import { domainApi } from '../api/domains';
export function DomainsPage() {
    const [domains, setDomains] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [newDomainSlug, setNewDomainSlug] = useState('');
    const [newDomainName, setNewDomainName] = useState('');
    const [creating, setCreating] = useState(false);
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const fetchDomains = async () => {
        try {
            setLoading(true);
            const data = await domainApi.list();
            setDomains(data);
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
        fetchDomains();
    }, []);
    const handleCreateDomain = async () => {
        if (!newDomainSlug.trim() || !newDomainName.trim()) {
            setError('Slug and name are required');
            return;
        }
        try {
            setCreating(true);
            await domainApi.create(newDomainSlug, newDomainName);
            setNewDomainSlug('');
            setNewDomainName('');
            setShowForm(false);
            setError('');
            await fetchDomains();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleDeleteDomain = async (id) => {
        try {
            setCreating(true);
            await domainApi.delete(id);
            setError('');
            await fetchDomains();
            setShowDeleteAlert(false);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "Domains" }) }) }), _jsxs(IonContent, { className: "ion-padding", children: [_jsx(IonLoading, { isOpen: creating, message: "Processing..." }), _jsx(IonAlert, { isOpen: showDeleteAlert, onDidDismiss: () => setShowDeleteAlert(false), header: "Confirm Delete", message: "Are you sure you want to delete this domain?", buttons: [
                            { text: 'Cancel', role: 'cancel' },
                            {
                                text: 'Delete',
                                role: 'destructive',
                                handler: () => {
                                    if (deleteTarget !== null) {
                                        handleDeleteDomain(deleteTarget);
                                    }
                                },
                            },
                        ] }), error && (_jsx(IonCard, { children: _jsxs(IonCardContent, { style: { color: 'red' }, children: [_jsx("strong", { children: "Error:" }), " ", error] }) })), _jsx(IonButton, { expand: "block", onClick: () => setShowForm(!showForm), className: "ion-margin-bottom", children: showForm ? 'Cancel' : 'New Domain' }), showForm && (_jsx(IonCard, { className: "ion-margin-bottom", children: _jsxs(IonCardContent, { children: [_jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Slug" }), _jsx(IonInput, { value: newDomainSlug, onIonChange: (e) => setNewDomainSlug(e.detail.value || ''), placeholder: "e.g., main-office" })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Name" }), _jsx(IonInput, { value: newDomainName, onIonChange: (e) => setNewDomainName(e.detail.value || ''), placeholder: "e.g., Main Office Domain" })] }), _jsx("div", { style: { marginTop: '16px', display: 'flex', gap: '8px' }, children: _jsx(IonButton, { expand: "block", onClick: handleCreateDomain, children: "Create" }) })] }) })), loading ? (_jsx("p", { children: "Loading domains..." })) : domains.length === 0 ? (_jsx("p", { children: "No domains yet. Create one to get started." })) : (_jsx(IonList, { children: domains.map((domain) => (_jsxs(IonItem, { children: [_jsxs(IonLabel, { children: [_jsx("strong", { children: domain.name }), _jsx("p", { children: domain.slug })] }), _jsx(IonButton, { slot: "end", color: "danger", size: "small", onClick: () => {
                                        setDeleteTarget(domain.id);
                                        setShowDeleteAlert(true);
                                    }, children: "Delete" })] }, domain.id))) }))] })] }));
}
