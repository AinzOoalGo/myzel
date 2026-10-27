// Minimal type declarations for Bun's built-in test runner and runtime,
// so `tsc --noEmit` can typecheck tests and scripts without extra packages.
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void): void;
  interface Matchers {
    toBe(v: unknown): void;
    toEqual(v: unknown): void;
    toBeCloseTo(v: number, digits?: number): void;
    toBeGreaterThan(v: number): void;
    toBeGreaterThanOrEqual(v: number): void;
    toBeLessThan(v: number): void;
    toBeLessThanOrEqual(v: number): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(v: unknown): void;
    toThrow(): void;
    not: Matchers;
  }
  export function expect(v: unknown): Matchers;
}

declare const Bun: {
  build(opts: Record<string, unknown>): Promise<{ success: boolean; outputs: { text(): Promise<string> }[]; logs: unknown[] }>;
  file(path: string): { text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
};
declare const process: { exit(code: number): never; argv: string[] };
