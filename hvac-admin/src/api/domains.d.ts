import { Domain } from '../types/api';
export declare const domainApi: {
    list: () => Promise<any>;
    get: (id: number) => Promise<any>;
    create: (slug: string, name: string) => Promise<Domain>;
    update: (id: number, slug: string, name: string) => Promise<Domain>;
    delete: (id: number) => Promise<any>;
};
