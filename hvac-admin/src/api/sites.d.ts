import { Site } from '../types/api';
export declare const siteApi: {
    listByDomain: (domainId: number) => Promise<any>;
    get: (id: number) => Promise<any>;
    create: (domainId: number, slug: string, name: string) => Promise<Site>;
    delete: (id: number) => Promise<any>;
};
