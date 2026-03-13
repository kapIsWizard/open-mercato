import { redirect } from 'next/navigation'

export default function PurchasingBackendPage() {
  redirect('/backend/purchasing/requests')
  return null
}
