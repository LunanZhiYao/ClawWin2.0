export declare function normalizeStringList(input: unknown): string[];
export declare function getFrontmatterString(frontmatter: Record<string, unknown>, key: string): string | undefined;
export declare function parseFrontmatterBool(value: string | undefined, fallback: boolean): boolean;
export declare function resolveOpenClawManifestBlock(params: {
    frontmatter: Record<string, unknown>;
    key?: string;
}): Record<string, unknown> | undefined;
