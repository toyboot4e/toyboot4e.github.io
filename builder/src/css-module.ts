// A CSS module's scoped-name map as a lookup that fails the build on a typo'd
// class, instead of silently rendering `class="undefined"`.
export const classes =
  (mod: CSSModuleClasses, file: string) =>
  (name: string): string => {
    const scoped = mod[name];
    if (scoped === undefined) {
      throw new Error(`${file}: no class .${name}`);
    }
    return scoped;
  };
