/** Modul generovaný při sestavení (scripts/build-upload.mjs) – obsah složky /public. */
declare module "virtual:assets" {
  const assets: Record<string, { type: string; body: string; base64?: boolean }>;
  export default assets;
}
