import type { Metadata } from 'next';
import Link from 'next/link';
import AgreeToTerms from '@/components/AgreeToTerms';

export const metadata: Metadata = { title: 'Terms of Use · ExiThreat' };

const CONTACT = 'senkumram777@gmail.com';
const UPDATED = '26 October 2026';

// The ExiThreat website and Android app share these terms; members agree to them when they sign
// up (older accounts before they next write anything: backend middleware/auth.ts, requireTerms).
export default function TermsPage() {
  return (
    <article className="flex flex-col gap-6 font-mono text-sm text-gray-300 leading-relaxed">
      <header>
        <h1 className="text-xl font-bold text-accent-teal">Terms of Use</h1>
        <p className="text-xs text-gray-500 mt-1">Last updated {UPDATED}</p>
      </header>

      <AgreeToTerms />

      <p>
        ExiThreat is a place to disclose abuse and threats of any kind without being named (at work, on the
        street, in a neighbourhood, by a police or government official, at home or online), and for other
        members to read, comment on and pass those disclosures on. By creating an account or using the ExiThreat
        website (exithreat.iyugam.com) or the ExiThreat Android app, you agree to these terms. If you do not agree,
        do not use ExiThreat.
      </p>

      <Section title="Who can use ExiThreat">
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>You must be 18 or older.</li>
          <li>One account per person. Each account needs its own email address and Indian mobile number.</li>
          <li>Keep your password to yourself. You are responsible for what is done with your account.</li>
        </ul>
      </Section>

      <Section title="What you must not post">
        <p>
          There is no tolerance for objectionable content or abusive members. In disclosures, comments and group chat
          you must not:
        </p>
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>harass, bully, threaten or intimidate anyone, or encourage violence or self-harm;</li>
          <li>attack people for their religion, caste, race, ethnicity, gender, sexual orientation, disability or age;</li>
          <li>post sexual content, or anything that sexualises a child;</li>
          <li>
            publish someone&apos;s private information (phone numbers, addresses, ID numbers and the like). Describe
            what happened; the automatic redaction is a safeguard, not permission;
          </li>
          <li>knowingly make false accusations, impersonate anyone, or post spam or advertising;</li>
          <li>post anything illegal, or that infringes someone else&apos;s rights;</li>
          <li>try to find out who another member is, or to get around a block, suspension or the site&apos;s safeguards.</li>
        </ul>
      </Section>

      <Section title="Reporting and blocking">
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>
            Every post, comment and chat message written by someone else has a <b>⋯</b> button. Use it to{' '}
            <b>report</b> it to the administrator, or to <b>block</b> the member who wrote it.
          </li>
          <li>
            Blocking hides that member&apos;s posts, comments and chat messages from you. They are not told. You can
            unblock them from your Account page.
          </li>
          <li>
            The administrator reviews reports and removes content that breaks these terms. Members who break them may
            be suspended or have their account deleted, without warning for serious cases.
          </li>
          <li>
            Content that puts someone in immediate danger can also be reported to {' '}
            <a href={`mailto:${CONTACT}`} className="text-accent-teal">{CONTACT}</a>. In an emergency, call 112.
          </li>
        </ul>
      </Section>

      <Section title="Your content">
        <p>
          What you write remains yours. You allow ExiThreat to store it, redact it, and show it to other members, and
          to police officers on the common page, as described in the{' '}
          <Link href="/privacy" className="text-accent-teal">Privacy Policy</Link>. You can delete your account, and
          with it everything you wrote, at any time from the Account page.
        </p>
      </Section>

      <Section title="No guarantees">
        <p>
          ExiThreat is provided as it is. We do not check that disclosures are true and are not responsible for what
          members write. We may change, pause or end the service, and change these terms; the new version will be
          posted here with a new date.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT}`} className="text-accent-teal">{CONTACT}</a>.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm text-gray-400 uppercase tracking-widest">{title}</h2>
      {children}
    </section>
  );
}
