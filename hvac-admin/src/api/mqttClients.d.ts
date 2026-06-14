import { MqttClient, AclPreview } from '../types/api';
export declare const mqttClientApi: {
    list: () => Promise<any>;
    get: (id: number) => Promise<any>;
    createHomey: (domainId: number) => Promise<MqttClient>;
    rotatePassword: (id: number) => Promise<{
        password: string;
    }>;
    toggle: (id: number, enabled: boolean) => Promise<MqttClient>;
    delete: (id: number) => Promise<any>;
    getAclPreview: (clientId: string) => Promise<AclPreview>;
    regenerateAcl: () => Promise<{
        generation_timestamp: string;
    }>;
};
