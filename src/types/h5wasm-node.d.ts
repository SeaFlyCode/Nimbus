// `h5wasm` expose son entree "node" via un subpath export ESM que le resolveur TypeScript
// "node" (CommonJS) ne sait pas typer nativement (fonctionne a l'execution via import() dynamique).
declare module 'h5wasm/node' {
  export const ready: Promise<unknown>;

  export interface H5Attribute {
    value: unknown;
  }

  export interface H5Group {
    attrs: Record<string, H5Attribute>;
  }

  export interface H5Dataset {
    attrs: Record<string, H5Attribute>;
    shape: number[];
    value: Uint16Array;
  }

  export class File {
    constructor(path: string, mode: string);
    get(path: string): H5Group | H5Dataset;
    keys(): string[];
    close(): void;
  }
}
