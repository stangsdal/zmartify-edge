import { SystemStatus } from '../types/api';
export declare const systemApi: {
    getStatus: () => Promise<SystemStatus>;
    getRegistryStatus: () => Promise<any>;
    getAclStatus: () => Promise<any>;
};
