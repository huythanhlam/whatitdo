import { SubscribeForm } from '@/components/SubscribeForm'

export default function SubscribePage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/95 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <a href="/" className="text-sm text-violet-600 hover:underline">← Back to events</a>
        </div>
      </header>

      <div className="flex items-start justify-center pt-12 pb-20 px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <p className="text-4xl mb-3">📬</p>
            <h1 className="text-2xl font-bold mb-2">Get Austin events in your inbox</h1>
            <p className="text-sm text-muted-foreground">
              We scan the web daily and send you a curated digest of Austin events.
              No spam — ever.
            </p>
          </div>
          <SubscribeForm />
        </div>
      </div>
    </div>
  )
}
