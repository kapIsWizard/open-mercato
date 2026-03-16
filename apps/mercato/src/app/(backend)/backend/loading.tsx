import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export default async function BackendLoading() {
  const { translate } = await resolveTranslations()

  return (
    <div className="p-6">
      <LoadingMessage label={translate('ui.backend.loading', 'Loading workspace...')} />
    </div>
  )
}
