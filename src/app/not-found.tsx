import Link from 'next/link'
import { AppHeader } from '@/components/AppHeader'
import { BACK_TO_PRODUCTS_LABEL } from '@/lib/labels'
import { ROUTES } from '@/lib/routes'

export const dynamic = 'force-dynamic'

export default function NotFound() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[920px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
          <h1 className="text-lg font-semibold tracking-tight">Página não encontrada.</h1>
          <Link href={ROUTES.products} className="btn btn-ghost">
            {BACK_TO_PRODUCTS_LABEL}
          </Link>
        </div>
      </main>
    </>
  )
}
