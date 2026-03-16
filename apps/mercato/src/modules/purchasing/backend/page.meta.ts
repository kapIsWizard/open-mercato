import React from 'react'

const purchasingIcon = React.createElement(
  'svg',
  { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
  React.createElement('path', { d: 'M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2' }),
  React.createElement('path', { d: 'M9 3h6v4H9z' }),
  React.createElement('path', { d: 'M13 12h5' }),
  React.createElement('path', { d: 'M16 9v6' }),
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Purchasing',
  pageTitleKey: 'purchasing.nav.root',
  pageGroup: 'Operations',
  pageGroupKey: 'purchasing.nav.group',
  pagePriority: 12,
  pageOrder: 12,
  icon: purchasingIcon,
}
