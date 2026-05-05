import { Suspense } from 'react'
import AuthForm from '../AuthForm'
import AuthShell from '../AuthShell'

export const dynamic = 'force-dynamic'

export default function SignInPage() {
  return (
    <AuthShell>
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </AuthShell>
  )
}
