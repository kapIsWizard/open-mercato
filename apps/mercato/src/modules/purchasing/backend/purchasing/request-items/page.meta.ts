import React from 'react'

const requestItemsIcon = React.createElement(
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
  React.createElement('path', { d: 'M3 7h18' }),
  React.createElement('path', { d: 'M6 12h12' }),
  React.createElement('path', { d: 'M9 17h6' }),
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Purchasing items',
  pageTitleKey: 'purchasing.items.page.title',
  pageGroup: 'Operations',
  pageGroupKey: 'purchasing.nav.group',
  pagePriority: 12,
  pageOrder: 14,
  icon: requestItemsIcon,
  breadcrumb: [{ label: 'Purchasing items', labelKey: 'purchasing.items.page.title' }],
}
