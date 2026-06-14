import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonList, IonItem, IonLabel, IonButton, IonCard, IonCardContent, IonInput, IonLoading, IonAlert, } from '@ionic/react';
import { siteApi } from '../api/sites';
import { domainApi } from '../api/domains';
export function SitesPage() {
    const [sites, setSites] = useState([]);
    const [domains, setDomains] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [selectedDomainId, setSelectedDomainId] = useState('');
    const [newSiteSlug, setNewSiteSlug] = useState('');
    const [newSiteName, setNewSiteName] = useState('');
    const [creating, setCreating] = useState(false);
    const [showDeleteAlert, setShowDeleteAlert] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const fetchDomains = async () => {
        try {
            const data = await domainApi.list();
            setDomains(data);
        }
        catch (e) {
            console.error('Failed to fetch domains:', e);
        }
    };
    const fetchSites = async () => {
        try {
            setLoading(true);
            const allSites = [];
            for (const domain of domains) {
                const sitesData = await siteApi.listByDomain(domain.id);
                allSites.push(...sitesData);
            }
            setSites(allSites);
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
    useEffect(() => {
        if (domains.length > 0) {
            fetchSites();
        }
    }, [domains]);
    const handleCreateSite = async () => {
        if (!selectedDomainId || !newSiteSlug.trim() || !newSiteName.trim()) {
            setError('Domain, slug, and name are required');
            return;
        }
        try {
            setCreating(true);
            await siteApi.create(parseInt(selectedDomainId), newSiteSlug, newSiteName);
            setNewSiteSlug('');
            setNewSiteName('');
            setSelectedDomainId('');
            setShowForm(false);
            setError('');
            await fetchSites();
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const handleDeleteSite = async (id) => {
        try {
            setCreating(true);
            await siteApi.delete(id);
            setError('');
            await fetchSites();
            setShowDeleteAlert(false);
        }
        catch (e) {
            setError(String(e));
        }
        finally {
            setCreating(false);
        }
    };
    const getDomainName = (domainId) => {
        const domain = domains.find((d) => d.id === domainId);
        return domain ? domain.name : `Domain ${domainId}`;
    };
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "Sites" }) }) }), _jsxs(IonContent, { className: "ion-padding", children: [_jsx(IonLoading, { isOpen: creating, message: "Processing..." }), _jsx(IonAlert, { isOpen: showDeleteAlert, onDidDismiss: () => setShowDeleteAlert(false), header: "Confirm Delete", message: "Are you sure you want to delete this site?", buttons: [
                            { text: 'Cancel', role: 'cancel' },
                            {
                                text: 'Delete',
                                role: 'destructive',
                                handler: () => {
                                    if (deleteTarget !== null) {
                                        handleDeleteSite(deleteTarget);
                                    }
                                },
                            },
                        ] }), error && (_jsx(IonCard, { children: _jsxs(IonCardContent, { style: { color: 'red' }, children: [_jsx("strong", { children: "Error:" }), " ", error] }) })), _jsx(IonButton, { expand: "block", onClick: () => setShowForm(!showForm), className: "ion-margin-bottom", children: showForm ? 'Cancel' : 'New Site' }), showForm && (_jsx(IonCard, { className: "ion-margin-bottom", children: _jsxs(IonCardContent, { children: [_jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Domain" }), _jsxs("select", { value: selectedDomainId, onChange: (e) => setSelectedDomainId(e.target.value), style: {
                                                width: '100%',
                                                padding: '8px',
                                                borderRadius: '4px',
                                                border: '1px solid #ccc',
                                            }, children: [_jsx("option", { value: "", children: "Select a domain..." }), domains.map((domain) => (_jsx("option", { value: domain.id, children: domain.name }, domain.id)))] })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Slug" }), _jsx(IonInput, { value: newSiteSlug, onIonChange: (e) => setNewSiteSlug(e.detail.value || ''), placeholder: "e.g., main-floor" })] }), _jsxs(IonItem, { children: [_jsx(IonLabel, { position: "stacked", children: "Name" }), _jsx(IonInput, { value: newSiteName, onIonChange: (e) => setNewSiteName(e.detail.value || ''), placeholder: "e.g., Main Floor" })] }), _jsx("div", { style: { marginTop: '16px', display: 'flex', gap: '8px' }, children: _jsx(IonButton, { expand: "block", onClick: handleCreateSite, children: "Create" }) })] }) })), loading ? (_jsx("p", { children: "Loading sites..." })) : sites.length === 0 ? (_jsx("p", { children: "No sites yet. Create one to get started." })) : (_jsx(IonList, { children: sites.map((site) => (_jsxs(IonItem, { children: [_jsxs(IonLabel, { children: [_jsx("strong", { children: site.name }), _jsx("p", { children: site.slug }), _jsxs("p", { style: { fontSize: '0.8em', color: '#666' }, children: ["Domain: ", getDomainName(site.domain_id)] })] }), _jsx(IonButton, { slot: "end", color: "danger", size: "small", onClick: () => {
                                        setDeleteTarget(site.id);
                                        setShowDeleteAlert(true);
                                    }, children: "Delete" })] }, site.id))) }))] })] }));
}
