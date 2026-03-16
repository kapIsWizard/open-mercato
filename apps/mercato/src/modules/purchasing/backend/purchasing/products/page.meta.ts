import React from 'react'

const productsIcon = React.createElement(
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
  React.createElement('path', { d: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z' }),
  React.createElement('path', { d: 'm3.3 7 8.7 5 8.7-5' }),
  React.createElement('path', { d: 'M12 22V12' }),
)

export const metadata = {
  requireAuth: true,
  pageTitle: 'Purchasing products',
  pageTitleKey: 'purchasing.products.page.title',
  navHidden: true,
  pageGroup: 'Operations',
  pageGroupKey: 'purchasing.nav.group',
  pagePriority: 12,
  pageOrder: 15,
  icon: productsIcon,
  breadcrumb: [{ label: 'Imported products', labelKey: 'purchasing.products.page.title' }],
}

export default metadata
