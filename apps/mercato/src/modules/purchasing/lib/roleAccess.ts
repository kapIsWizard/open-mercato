const VIEWER_ROLES = ['sales', 'bok', 'purchasing', 'admin', 'superadmin'] as const
const CREATE_ROLES = ['sales', 'bok', 'purchasing', 'admin', 'superadmin'] as const
const COMMENT_ROLES = ['sales', 'bok', 'purchasing', 'admin', 'superadmin'] as const
const MANAGER_ROLES = ['purchasing', 'admin', 'superadmin'] as const
const EXPANDED_CREATE_ROLES = ['bok', 'purchasing', 'admin', 'superadmin'] as const

function hasRole(roleNames: readonly string[], allowedRoles: readonly string[]): boolean {
  const normalized = new Set(roleNames.map((role) => role.trim()).filter(Boolean))
  return allowedRoles.some((role) => normalized.has(role))
}

export function canAccessPurchasingModule(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, VIEWER_ROLES)
}

export function canCreatePurchasingRequest(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, CREATE_ROLES)
}

export function canUseExpandedPurchasingCreate(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, EXPANDED_CREATE_ROLES)
}

export function canManagePurchasingRequest(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, MANAGER_ROLES)
}

export function canManagePurchasingItems(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, MANAGER_ROLES)
}

export function canManagePurchasingComments(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, COMMENT_ROLES)
}

export function canViewPurchasingOperationalItems(roleNames: readonly string[]): boolean {
  return hasRole(roleNames, MANAGER_ROLES)
}
