'use client'

import { AiAssistantIntegration, AiChatHeaderButton } from '@open-mercato/ai-assistant/frontend'

type DeferredAiAssistantChromeProps = {
  tenantId: string | null
  organizationId: string | null
}

export function DeferredAiAssistantChrome({ tenantId, organizationId }: DeferredAiAssistantChromeProps) {
  return (
    <AiAssistantIntegration tenantId={tenantId} organizationId={organizationId}>
      <AiChatHeaderButton />
    </AiAssistantIntegration>
  )
}
