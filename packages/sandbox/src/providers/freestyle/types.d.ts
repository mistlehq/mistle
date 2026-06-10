import "freestyle";

// Freestyle 0.1.63 exports VmBaseImage and VmSpec at runtime from its public
// package entrypoint, but its published index.d.mts does not declare those
// exports. Keep this augmentation narrow to the builder APIs this provider uses
// until the upstream SDK declarations expose the runtime exports directly.
declare module "freestyle" {
  export type FreestyleRawBaseImage = {
    readonly dockerfileContent: string;
  };

  export type FreestyleRawSnapshotFile = {
    readonly content: string;
    readonly encoding: "base64";
    readonly executable: boolean;
  };

  export class VmBaseImage {
    constructor(base?: string | FreestyleRawBaseImage);
    from(baseImage: VmBaseImage | FreestyleRawBaseImage | string): this;
    runCommands(...commands: string[]): this;
    appendDockerfile(dockerfile: string): this;
    hasFromInstruction(): boolean;
    toRaw(): FreestyleRawBaseImage;
  }

  export class VmSpec {
    readonly raw: {
      readonly baseImage?: VmBaseImage | FreestyleRawBaseImage;
      readonly workdir?: string;
      readonly additionalFiles?: Readonly<Record<string, FreestyleRawSnapshotFile>>;
    };

    constructor();
    baseImage(baseImage: VmBaseImage | FreestyleRawBaseImage): this;
    workdir(path: string): this;
    additionalFiles(files: Readonly<Record<string, FreestyleRawSnapshotFile>>): this;
  }
}
