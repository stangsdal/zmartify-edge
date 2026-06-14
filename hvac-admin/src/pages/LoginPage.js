import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { IonContent, IonHeader, IonTitle, IonToolbar, IonPage, IonLabel, IonInput, IonButton, IonCard, } from '@ionic/react';
import { apiClient } from '../api/client';
export function LoginPage() {
    const [token, setToken] = useState('');
    const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem('api_base_url') || 'http://192.168.10.53:8080');
    const [message, setMessage] = useState('');
    const history = useHistory();
    useEffect(() => {
        const stored = localStorage.getItem('admin_api_token');
        if (stored) {
            history.push('/dashboard');
        }
    }, [history]);
    const handleSaveToken = () => {
        if (token.trim()) {
            apiClient.setAuthToken(token);
            apiClient.setBaseUrl(baseUrl);
            setMessage('Token saved');
            setTimeout(() => {
                history.push('/dashboard');
            }, 500);
        }
    };
    const handleClearToken = () => {
        setToken('');
        localStorage.removeItem('admin_api_token');
        setMessage('Token cleared');
    };
    return (_jsxs(IonPage, { children: [_jsx(IonHeader, { children: _jsx(IonToolbar, { children: _jsx(IonTitle, { children: "HVAC Admin - Login" }) }) }), _jsx(IonContent, { className: "ion-padding", children: _jsx(IonCard, { children: _jsxs("div", { style: { padding: '16px' }, children: [_jsx("h2", { children: "API Configuration" }), _jsx(IonLabel, { children: "API Base URL" }), _jsx(IonInput, { value: baseUrl, onIonChange: (e) => setBaseUrl(e.detail.value || ''), placeholder: "http://192.168.10.53:8080" }), _jsx(IonLabel, { style: { marginTop: '16px', display: 'block' }, children: "Admin Bearer Token" }), _jsx(IonInput, { value: token, onIonChange: (e) => setToken(e.detail.value || ''), placeholder: "Bearer token", type: "password" }), _jsxs("div", { style: { marginTop: '16px', display: 'flex', gap: '8px' }, children: [_jsx(IonButton, { onClick: handleSaveToken, expand: "block", children: "Save" }), _jsx(IonButton, { onClick: handleClearToken, expand: "block", color: "medium", children: "Clear" })] }), message && _jsx("p", { style: { color: 'green', marginTop: '8px' }, children: message })] }) }) })] }));
}
