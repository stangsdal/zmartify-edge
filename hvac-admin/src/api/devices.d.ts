import { Device } from '../types/api';
export declare const deviceApi: {
    list: () => Promise<any>;
    get: (deviceId: string) => Promise<any>;
    create: (deviceId: string, displayName: string, mac?: string, firmwareVersion?: string) => Promise<Device>;
    assignToSite: (deviceId: string, siteId: number) => Promise<Device>;
    delete: (deviceId: string) => Promise<any>;
};
