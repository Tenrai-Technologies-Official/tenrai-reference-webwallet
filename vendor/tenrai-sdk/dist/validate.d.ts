export declare const U16 = 65535;
export declare const U32 = 4294967295;
export declare function hash384(value: string, name?: string): string;
export declare function hex(value: string, name: string): string;
export declare function address(value: string): string;
export declare function addresses(values: readonly string[], most: number): string[];
export declare function whole(value: number, name: string, most?: number): number;
export declare function limit(value: number | undefined, most: number): number | undefined;
export declare function cursor(value: string | undefined): string | undefined;
