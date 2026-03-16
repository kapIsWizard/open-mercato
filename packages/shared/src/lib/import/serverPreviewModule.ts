export async function importServerPreviewModule<TModule>(modulePath: string): Promise<TModule> {
  const importer = new Function('p', 'return import(p)') as (path: string) => Promise<TModule>
  return importer(modulePath)
}
