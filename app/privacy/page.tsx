import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How Whats Happenin collects, uses, and protects your information when you browse events, subscribe to updates, or create an account.',
}

// Static, city-agnostic legal page. Lives at the app root (not under [city]) so
// there's a single canonical /privacy URL linked from the global footer.
const UPDATED = 'July 22, 2026'
const INSTAGRAM_URL = 'https://www.instagram.com/whatshappenin.atx/'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to events
        </Link>

        <h1 className="mt-6 font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-foreground/90">
          <p>
            Whats Happenin (&ldquo;we,&rdquo; &ldquo;us&rdquo;) helps you discover local events,
            concerts, and things to do. This policy explains what information we collect, how we use
            it, and the choices you have. By using the site you agree to the practices described here.
          </p>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Information we collect</h2>
            <ul className="list-disc space-y-2 pl-5 text-foreground/90">
              <li>
                <strong className="font-semibold text-foreground">Account details.</strong> If you
                create an account, we store your email address and any profile preferences you set
                (such as favorite categories).
              </li>
              <li>
                <strong className="font-semibold text-foreground">Email subscriptions.</strong> When
                you sign up for event updates, we store your email address so we can send the digests
                you requested.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Activity.</strong> To power
                recommendations and improve the site, we record actions like saving, hiding, or
                marking interest in events, and usage analytics such as pages viewed, sign-ups, and
                event submissions.
              </li>
              <li>
                <strong className="font-semibold text-foreground">Event submissions.</strong> If you
                submit an event, we collect the details you provide so we can review and publish it.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">How we use your information</h2>
            <ul className="list-disc space-y-2 pl-5 text-foreground/90">
              <li>Show you relevant events and personalized recommendations.</li>
              <li>Send the email updates and digests you&rsquo;ve subscribed to.</li>
              <li>Operate, maintain, secure, and improve the site.</li>
              <li>Review and publish events submitted by the community.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Analytics and cookies</h2>
            <p>
              We use Google Analytics to understand how visitors find and use the site — for example,
              which pages are popular and how many people sign up. Google Analytics sets cookies and
              collects information such as your approximate location, device, and pages visited, and
              also measures page performance (load speed and responsiveness). This helps us fix slow
              pages and improve the experience. We do not use this data for advertising. To learn more,
              see{' '}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Google&rsquo;s Privacy Policy
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Sharing</h2>
            <p>
              We do not sell your personal information. We share data only with service providers that
              help us run the site (for example, hosting, database, and email delivery), and only as
              needed to provide those services. We may disclose information if required by law.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Third-party links</h2>
            <p>
              Event listings link out to ticketing platforms, venues, and organizers. Once you leave
              our site, their privacy practices — not ours — govern the information you share with
              them.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Your choices</h2>
            <p>
              You can unsubscribe from any email using the link in that message. You may request access
              to, correction of, or deletion of your account data by contacting us. Deleting your
              account removes your associated profile and preference data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Changes to this policy</h2>
            <p>
              We may update this policy from time to time. When we do, we&rsquo;ll revise the
              &ldquo;last updated&rdquo; date above. Continued use of the site after changes take
              effect means you accept the revised policy.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-foreground">Contact</h2>
            <p>
              Questions about this policy or your data? Reach out via our Instagram,{' '}
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                @whatshappenin.atx
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
