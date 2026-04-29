export type ContinuitySource = 'codex' | 'claude';
export type ContinuityPreset = 'compact' | 'standard' | 'full';
export type ContinuityOutput = 'clipboard' | 'file';
export interface ContinuitySession {
    id: string;
    source: ContinuitySource;
    cwd: string;
    branch?: string;
    model?: string;
    summary?: string;
    rawPath: string;
    updatedAtMs: number;
    createdAtMs: number;
    bytes: number;
    origin: 'real-home' | 'mms-slot' | 'mms-project' | 'mms-account' | 'env-home';
}
export interface ContinuityOptions {
    ref?: string;
    print?: boolean;
    copy?: boolean;
    list?: boolean;
    preset?: ContinuityPreset;
    output?: ContinuityOutput;
    limit?: number;
    git?: boolean;
    all?: boolean;
    refresh?: boolean;
    cache?: boolean;
}
export declare function discoverContinuitySessions(opts?: {
    cwd?: string;
    limit?: number;
    all?: boolean;
    refresh?: boolean;
    cache?: boolean;
}): ContinuitySession[];
export declare function cmdContinuity(argv: string[]): Promise<void>;
