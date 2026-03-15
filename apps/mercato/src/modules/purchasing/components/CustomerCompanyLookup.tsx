"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CustomerCompanyLookupOption = {
  id: string
  displayName: string
  primaryEmail: string | null
  primaryPhone: string | null
}

type CompaniesLookupResponse = {
  items?: CustomerCompanyLookupOption[]
}

type CustomerCompanyLookupProps = {
  value: string
  onChange: (next: CustomerCompanyLookupOption | null) => void
  disabled?: boolean
}

export function CustomerCompanyLookup({
  value,
  onChange,
  disabled = false,
}: CustomerCompanyLookupProps) {
  const t = useT()
  const [options, setOptions] = React.useState<CustomerCompanyLookupOption[]>([])

  const loadSuggestions = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: '8',
    })
    if (query?.trim()) params.set('search', query.trim())
    const payload = await readApiResultOrThrow<CompaniesLookupResponse>(`/api/purchasing/companies?${params.toString()}`)
    const next = Array.isArray(payload.items) ? payload.items : []
    setOptions(next)
    return next.map((item) => ({
      value: item.id,
      label: item.displayName,
      description: item.primaryEmail ?? item.primaryPhone ?? null,
    }))
  }, [])

  const resolveOption = React.useCallback((id: string): CustomerCompanyLookupOption | null => {
    return options.find((option) => option.id === id) ?? null
  }, [options])

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <ComboboxInput
          value={value}
          onChange={(next) => onChange(resolveOption(next))}
          placeholder={t('purchasing.requests.fields.customerCompanyPlaceholder', 'Search existing companies')}
          loadSuggestions={loadSuggestions}
          allowCustomValues={false}
          disabled={disabled}
          resolveLabel={(candidate) => resolveOption(candidate)?.displayName ?? candidate}
          resolveDescription={(candidate) => resolveOption(candidate)?.primaryEmail ?? resolveOption(candidate)?.primaryPhone}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(null)}
          disabled={disabled || !value}
        >
          {t('common.clear', 'Clear')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('purchasing.requests.fields.customerCompanyHint', 'Link the request to an existing Open Mercato company when possible.')}
      </p>
    </div>
  )
}
