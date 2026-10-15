import { redirect } from 'next/navigation'

// The cashier screen arrives in M3; until then the root sends staff to the admin.
export default function HomePage() {
  redirect('/admin')
}
