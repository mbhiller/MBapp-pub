type EventV2 = {
    rawPath?: string;
    requestContext?: {
        http?: {
            method?: string;
        };
    };
    queryStringParameters?: Record<string, string | undefined>;
    pathParameters?: Record<string, string | undefined>;
    headers?: Record<string, string | undefined>;
    body?: string;
    isBase64Encoded?: boolean;
};
export declare const handler: (evt: EventV2) => Promise<{
    statusCode: number;
    headers: {
        "content-type": string;
        "access-control-allow-origin": string;
        "access-control-allow-methods": string;
        "access-control-allow-headers": string;
    };
    body: string;
}>;
export {};
