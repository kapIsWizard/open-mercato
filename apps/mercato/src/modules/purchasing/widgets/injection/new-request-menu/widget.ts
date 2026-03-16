import type { InjectionMenuItemWidget } from '@open-mercato/shared/modules/widgets/injection'

const widget: InjectionMenuItemWidget = {
  metadata: {
    id: 'purchasing.injection.new-request-menu',
  },
  menuItems: [
    {
      id: 'purchasing-new-request-shortcut',
      labelKey: 'purchasing.requests.actions.add',
      label: 'Nowe zapytanie',
      icon: 'PlusSquare',
      href: '/backend/purchasing/requests/create',
      groupId: 'purchasing.nav.group',
      groupLabelKey: 'purchasing.nav.group',
    },
  ],
}

export default widget
