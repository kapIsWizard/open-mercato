import React from 'react'

const requestsIcon = React.createElement(
  'svg',
  {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  },
  React.createElement('path', { d: 'M8 6h13' }),
  React.createElement('path', { d: 'M8 12h13' }),
  React.createElement('path', { d: 'M8 18h13' }),
  React.createElement('path', { d: 'M3 6h.01' }),
  React.createElement('path', { d: 'M3 12h.01' }),
  React.createElement('path', { d: 'M3 18h.01' }),
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Purchasing requests',
  pageTitleKey: 'purchasing.requests.page.title',
  pageGroup: 'Operations',
  pageGroupKey: 'purchasing.nav.group',
  pagePriority: 12,
  pageOrder: 13,
  icon: requestsIcon,
  breadcrumb: [{ label: 'Purchasing requests', labelKey: 'purchasing.requests.page.title' }],
}
