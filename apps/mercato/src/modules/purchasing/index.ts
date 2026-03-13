import './commands/requests'
import './commands/request-items'
import './commands/comments'
import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'purchasing',
  title: 'Purchasing Requests',
  version: '0.1.0',
  description: 'POC module for handling purchasing requests and request items.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

