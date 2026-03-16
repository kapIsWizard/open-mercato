'use client'

import * as React from 'react'
import { ProfileDropdown } from '@open-mercato/ui/backend/ProfileDropdown'
import { IntegrationsButton } from '@open-mercato/ui/backend/IntegrationsButton'
import { SettingsButton } from '@open-mercato/ui/backend/SettingsButton'
import { MessagesIcon } from '@open-mercato/ui/backend/messages'
import { GlobalSearchDialog } from '@open-mercato/search/modules/search/frontend'
import OrganizationSwitcher from '@/components/OrganizationSwitcher'
import { NotificationBellWrapper } from '@/components/NotificationBellWrapper'
import { DeferredAiAssistantChrome } from '@/components/DeferredAiAssistantChrome'

type DeferredMountProps = {
  children: React.ReactNode
  fallback?: React.ReactNode
  timeoutMs?: number
}

function DeferredMount({ children, fallback = null, timeoutMs = 1200 }: DeferredMountProps) {
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let idleId: number | null = null

    const finish = () => {
      if (!cancelled) setReady(true)
    }

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(finish, { timeout: timeoutMs })
    } else {
      timeoutId = globalThis.setTimeout(finish, timeoutMs)
    }

    return () => {
      cancelled = true
      if (idleId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId)
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [timeoutMs])

  return ready ? <>{children}</> : <>{fallback}</>
}

type BackendRightHeaderProps = {
  email?: string | null
  showIntegrationsButton: boolean
  tenantId: string | null
  organizationId: string | null
  embeddingConfigured: boolean
  missingConfigMessage: string
  lean?: boolean
}

export function BackendRightHeader({
  email,
  showIntegrationsButton,
  tenantId,
  organizationId,
  embeddingConfigured,
  missingConfigMessage,
  lean = false,
}: BackendRightHeaderProps) {
  return (
    <>
      <GlobalSearchDialog embeddingConfigured={embeddingConfigured} missingConfigMessage={missingConfigMessage} />
      {!lean ? (
        <div className="hidden lg:contents">
          <DeferredMount>
            <OrganizationSwitcher />
          </DeferredMount>
        </div>
      ) : null}
      {showIntegrationsButton ? <IntegrationsButton /> : null}
      <SettingsButton />
      {!lean ? (
        <>
          <ProfileDropdown email={email ?? undefined} />
          <DeferredMount>
            <NotificationBellWrapper />
          </DeferredMount>
          <DeferredMount>
            <MessagesIcon />
          </DeferredMount>
          <DeferredMount timeoutMs={1800}>
            <DeferredAiAssistantChrome tenantId={tenantId} organizationId={organizationId} />
          </DeferredMount>
        </>
      ) : null}
    </>
  )
}

export function BackendMobileSidebarChrome({ lean = false }: { lean?: boolean }) {
  if (lean) return null

  return (
    <DeferredMount>
      <OrganizationSwitcher compact />
    </DeferredMount>
  )
}
