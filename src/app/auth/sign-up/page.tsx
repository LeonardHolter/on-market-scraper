import { Suspense } from 'react'
import AuthForm from '../AuthForm'
import AuthShell from '../AuthShell'

export const dynamic = 'force-dynamic'

export default function SignUpPage() {
  return (
    <AuthShell>
      <Suspense>
        <AuthForm mode="sign-up" />
      </Suspense>
    </AuthShell>
  )
}
