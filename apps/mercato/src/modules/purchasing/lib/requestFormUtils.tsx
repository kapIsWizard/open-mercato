"use client"

import * as React from 'react'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { mapCrudServerErrorToFormErrors, type CrudServerFieldErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import { cn } from '@open-mercato/shared/lib/utils'

export type PurchasingFormErrors = CrudServerFieldErrors

export type PurchasingDraftItemValidation = {
  productName: string
  quantity: string
}

export type PurchasingRecordItemValidation = {
  productName: string
  quantity: string
}

export type PurchasingCreateFormValidation = {
  customerCompanyId: string
  customerName: string
  customerNip: string
  items: PurchasingDraftItemValidation[]
}

export type PurchasingDetailFormValidation = {
  customerName: string
  customerNip: string
}

export function resolvePurchasingFormError(
  error: unknown,
  fallbackMessage: string,
): { message: string; fieldErrors: PurchasingFormErrors } {
  const { message, fieldErrors } = mapCrudServerErrorToFormErrors(error)
  return {
    message: typeof message === 'string' && message.trim().length > 0 ? message.trim() : fallbackMessage,
    fieldErrors: fieldErrors ?? {},
  }
}

export function validateCreateRequestForm(
  input: {
    customerCompanyId: string
    customerName: string
    customerNip: string
    items: Array<{ productName: string; quantity: string }>
  },
  t: (key: string, fallback?: string) => string,
): { message?: string; fieldErrors: PurchasingFormErrors } {
  const fieldErrors: PurchasingFormErrors = {}

  if (!input.customerCompanyId.trim() && !input.customerName.trim() && !input.customerNip.trim()) {
    const message = t('purchasing.validation.customerRequired', 'Provide customer name or NIP.')
    fieldErrors.customerName = message
    fieldErrors.customerNip = message
  }

  if (!input.items.length) {
    fieldErrors.items = t('purchasing.validation.itemsRequired', 'Add at least one request item.')
  }

  input.items.forEach((item, index) => {
    if (!item.productName.trim()) {
      fieldErrors[`items.${index}.productName`] = t(
        'purchasing.validation.productNameRequired',
        'Product name is required.',
      )
    }
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      fieldErrors[`items.${index}.quantity`] = t(
        'purchasing.validation.quantityPositiveInteger',
        'Quantity must be a whole number greater than 0.',
      )
    }
  })

  return {
    message:
      Object.keys(fieldErrors).length > 0
        ? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.')
        : undefined,
    fieldErrors,
  }
}

export function validateRequestDetailForm(
  input: { customerName: string | null; customerNip: string | null },
  t: (key: string, fallback?: string) => string,
): { message?: string; fieldErrors: PurchasingFormErrors } {
  const customerName = input.customerName?.trim() ?? ''
  const customerNip = input.customerNip?.trim() ?? ''
  const fieldErrors: PurchasingFormErrors = {}

  if (!customerName && !customerNip) {
    const message = t('purchasing.validation.customerRequired', 'Provide customer name or NIP.')
    fieldErrors.customerName = message
    fieldErrors.customerNip = message
  }

  return {
    message:
      Object.keys(fieldErrors).length > 0
        ? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.')
        : undefined,
    fieldErrors,
  }
}

export function validateRequestItemForm(
  input: { productName: string; quantity: number },
  t: (key: string, fallback?: string) => string,
): { message?: string; fieldErrors: PurchasingFormErrors } {
  const fieldErrors: PurchasingFormErrors = {}

  if (!input.productName.trim()) {
    fieldErrors.productName = t('purchasing.validation.productNameRequired', 'Product name is required.')
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isInteger(input.quantity)) {
    fieldErrors.quantity = t(
      'purchasing.validation.quantityPositiveInteger',
      'Quantity must be a whole number greater than 0.',
    )
  }

  return {
    message:
      Object.keys(fieldErrors).length > 0
        ? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.')
        : undefined,
    fieldErrors,
  }
}

export function validateCommentForm(
  body: string,
  t: (key: string, fallback?: string) => string,
): { message?: string; fieldErrors: PurchasingFormErrors } {
  const fieldErrors: PurchasingFormErrors = {}
  if (!body.trim()) {
    fieldErrors.body = t('purchasing.validation.commentBodyRequired', 'Comment body is required.')
  }
  return {
    message:
      Object.keys(fieldErrors).length > 0
        ? t('purchasing.validation.fixHighlightedFields', 'Check the highlighted fields and try again.')
        : undefined,
    fieldErrors,
  }
}

export function clearFieldError(
  errors: PurchasingFormErrors,
  field: string,
): PurchasingFormErrors {
  if (!errors[field]) return errors
  const nextErrors = { ...errors }
  delete nextErrors[field]
  return nextErrors
}

export function requiredLabel(
  label: string,
  t: (key: string, fallback?: string) => string,
): string {
  return `${label} ${t('purchasing.validation.requiredMark', '*')}`
}

export function FieldLabel({
  children,
  required = false,
}: {
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className="text-sm font-medium">
      {children}
      {required ? <span className="ml-1 text-destructive">*</span> : null}
    </label>
  )
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}

export function FormErrorNotice({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <Notice
      variant="error"
      compact
      className="border-destructive/20 bg-destructive/5 text-destructive"
      message={message}
    />
  )
}

export function fieldClassName(message?: string | null): string | undefined {
  return message ? 'border-destructive focus-visible:ring-destructive/30' : undefined
}

export function selectClassName(message?: string | null): string {
  return cn(
    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
    message ? 'border-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30' : null,
  )
}
