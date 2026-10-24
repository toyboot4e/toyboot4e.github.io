// The environment variables the build reads, so `process.env.X` is checked against this list.
declare namespace NodeJS {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface ProcessEnv {
    readonly ASSETS_CLI?: string;
    readonly BUILD_PROF?: string;
    readonly BUILD_WORKERS?: string;
    readonly CI?: string;
    readonly DEV_PORT?: string;
    readonly OUT_DIR?: string;
    readonly UPDATE_GOLDEN?: string;
  }
}
