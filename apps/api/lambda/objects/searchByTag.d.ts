export declare const handler: (evt: any) => Promise<{
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
} | {
    statusCode: number;
    headers: {
        "content-type": string;
    };
    body: string;
}>;
