type Json = Record<string, any> | any[];
export declare const ok: (data: Json, status?: number) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const bad: (message?: string) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const notfound: (message?: string) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const conflict: (message?: string) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const notimpl: (route?: string) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const error: (err: unknown) => {
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export declare const preflight: () => {
    statusCode: number;
    headers: {
        "access-control-max-age": string;
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
};
export {};
