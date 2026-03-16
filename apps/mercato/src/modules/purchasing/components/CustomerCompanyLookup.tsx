"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type CustomerCompanyLookupOption = {
  id: string
  displayName: string
  taxId: string | null
  primaryEmail: string | null
  primaryPhone: string | null
}

type CompaniesLookupResponse = {
  items?: CustomerCompanyLookupOption[]
}

type CustomerCompanyLookupProps = {
  value: string
  onChange: (next: CustomerCompanyLookupOption | null) => void
  selectedOption?: CustomerCompanyLookupOption | null
  disabled?: boolean
}

type CustomerCompanySuggestInputProps = {
  value: string
  onValueChange: (next: string) => void
  onSelectCompany: (next: CustomerCompanyLookupOption) => void
  placeholder: string
  disabled?: boolean
  dataTestId?: string
  ariaInvalid?: boolean
  className?: string
  mode: 'displayName' | 'taxId'
  onBlur?: React.FocusEventHandler<HTMLInputElement>
}

function buildCompanyDescription(option: CustomerCompanyLookupOption): string | null {
  const parts = [
    option.taxId ? `NIP ${option.taxId}` : null,
    option.primaryEmail,
    option.primaryPhone,
  ].filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
  return parts.length ? parts.join(' · ') : null
}

export async function fetchCustomerCompanyOptions(query?: string): Promise<CustomerCompanyLookupOption[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: '8',
  })
  if (query?.trim()) params.set('search', query.trim())
  try {
    const payload = await readApiResultOrThrow<CompaniesLookupResponse>(`/api/purchasing/companies?${params.toString()}`)
    return Array.isArray(payload.items) ? payload.items : []
  } catch {
    return []
  }
}

export function CustomerCompanyLookup({
  value,
  onChange,
  selectedOption = null,
  disabled = false,
}: CustomerCompanyLookupProps) {
  const t = useT()
  const [options, setOptions] = React.useState<CustomerCompanyLookupOption[]>([])

  const loadSuggestions = React.useCallback(async (query?: string): Promise<ComboboxOption[]> => {
    const next = await fetchCustomerCompanyOptions(query)
    setOptions(next)
    return next.map((item) => ({
      value: item.id,
      label: item.displayName,
      description: buildCompanyDescription(item),
    }))
  }, [])

  const resolveOption = React.useCallback((id: string): CustomerCompanyLookupOption | null => {
    if (selectedOption?.id === id) return selectedOption
    return options.find((option) => option.id === id) ?? null
  }, [options, selectedOption])

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
          resolveDescription={(candidate) => {
            const option = resolveOption(candidate)
            return option ? buildCompanyDescription(option) : null
          }}
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

export function CustomerCompanySuggestInput({
  value,
  onValueChange,
  onSelectCompany,
  placeholder,
  disabled = false,
  dataTestId,
  ariaInvalid,
  className,
  mode,
  onBlur,
}: CustomerCompanySuggestInputProps) {
  const t = useT()
  const [options, setOptions] = React.useState<CustomerCompanyLookupOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const cacheRef = React.useRef(new Map<string, CustomerCompanyLookupOption[]>())
  const minQueryLength = mode === 'taxId' ? 3 : 2
  const query = value.trim()

  React.useEffect(() => {
    if (disabled || !open) return
    if (query.length < minQueryLength) {
      setOptions([])
      setLoading(false)
      return
    }
    const cacheKey = `${mode}:${query.toLowerCase()}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setOptions(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    const handle = window.setTimeout(async () => {
      setLoading(true)
      try {
        const next = await fetchCustomerCompanyOptions(query)
        if (!cancelled) {
          cacheRef.current.set(cacheKey, next)
          setOptions(next)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [disabled, minQueryLength, mode, open, query])

  const visibleOptions = React.useMemo(
    () => options.filter((option) => mode === 'displayName' || Boolean(option.taxId)),
    [mode, options],
  )

  return (
    <div className="relative">
      <Input
        data-testid={dataTestId}
        value={value}
        onFocus={() => {
          setOpen(query.length >= minQueryLength)
        }}
        onChange={(event) => {
          onValueChange(event.target.value)
          setOpen(event.target.value.trim().length >= minQueryLength)
        }}
        onBlur={(event) => {
          window.setTimeout(() => setOpen(false), 150)
          onBlur?.(event)
        }}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        className={className}
        disabled={disabled}
      />
      {open && !disabled && query.length >= minQueryLength && (loading || visibleOptions.length > 0) ? (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {t('common.loading', 'Loading...')}
            </div>
          ) : (
            visibleOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onSelectCompany(option)
                  setOpen(false)
                }}
              >
                <span className="text-sm font-medium">{option.displayName}</span>
                {buildCompanyDescription(option) ? (
                  <span className="text-xs text-muted-foreground">{buildCompanyDescription(option)}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
