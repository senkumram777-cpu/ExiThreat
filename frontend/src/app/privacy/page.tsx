import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy Policy · ExiThreat' };

const CONTACT = 'senkumram777@gmail.com';
const UPDATED = '22 October 2026';

// The ExiThreat website and Android app share this policy (Play Store listing → Privacy policy).
// Keep it in step with what the backend stores: backend/prisma/schema.prisma.
export default function PrivacyPage() {
  return (
    <article className="flex flex-col gap-6 font-mono text-sm text-gray-300 leading-relaxed">
      <header>
        <h1 className="text-xl font-bold text-accent-teal">Privacy Policy</h1>
        <p className="text-xs text-gray-500 mt-1">Last updated {UPDATED}</p>
      </header>

      <p>
        ExiThreat is a place to disclose abuse and unfair practices at work without being named. This policy
        explains what the ExiThreat website (exithreat.iyugam.com) and the ExiThreat Android app collect, why,
        who can see it, and how to delete it. ExiThreat is for adults: you must be 18 or older to use it.
      </p>

      <Section title="What we collect">
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>
            <b>Your account:</b> a username you choose and a password. The password is stored only as a one-way
            hash; nobody, including us, can read it.
          </li>
          <li>
            <b>Your email address and Indian mobile number:</b> each is confirmed with a 6-digit code and then
            stored only as a one-way fingerprint, never as the address or number itself. The fingerprint keeps
            each email and mobile to one account and lets you sign in or reset your password with them.
          </li>
          <li>
            <b>A random pseudonym</b> given to you at sign-up, shown with your posts, comments and chat instead
            of your username.
          </li>
          <li>
            <b>What you write:</b> your disclosures (as you wrote them and an automatically redacted copy),
            comments, group chat messages and your votes.
          </li>
          <li>
            <b>How you use ExiThreat:</b> the days you use it, the time spent on it, and which disclosures you
            have read, used to work out your own and your group&apos;s weightage. Days of use are kept for 60
            days.
          </li>
          <li>
            <b>ProMic backups</b>, only if you link a ProMic account: the server then fetches your own ProMic
            backup recordings when you open them, to play them to you. They are not stored by ExiThreat.
          </li>
          <li>
            <b>Technical data:</b> your device&apos;s network address is used briefly to limit repeated
            requests, and the servers keep short-lived logs of errors.
          </li>
        </ul>
        <p className="mt-2">
          We do not collect your location, contacts, photos or files. There are no ads and no third-party
          analytics or tracking. The Android app asks for no permission other than internet access.
        </p>
      </Section>

      <Section title="Who can see what">
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>Other members see your pseudonym, never your username, email or mobile number.</li>
          <li>
            A disclosure goes to randomly chosen groups you are not in. Their members may read the original
            once, as an image, then see the redacted copy. Disclosures that spread widely reach the common page,
            where members see the redacted copy.
          </li>
          <li>
            Police officers registered through ProMic&apos;s law-enforcement programme can read both the
            original and the redacted copy of disclosures on the common page.
          </li>
          <li>
            The administrator can read posts, comments and group chat, and can suspend or delete accounts and
            content that break the rules.
          </li>
        </ul>
      </Section>

      <Section title="Services we use">
        <ul className="list-disc pl-5 flex flex-col gap-2">
          <li>Fly.io hosts the website, the server and the database (in Singapore).</li>
          <li>
            Google Firebase confirms mobile numbers by SMS. The temporary Firebase sign-in this creates is deleted
            straight after the number is confirmed.
          </li>
          <li>Gmail sends email confirmation codes.</li>
        </ul>
        <p className="mt-2">We do not sell or share your data with anyone else.</p>
      </Section>

      <Section title="Security">
        <p>
          Everything travels over encrypted connections (HTTPS). Passwords, email addresses and mobile numbers
          are stored only as one-way hashes. You can sign out of every device from your Account page.
        </p>
      </Section>

      <Section title="Keeping and deleting your data">
        <p>
          Your account and what you wrote are kept until you delete your account. You can delete it at any time
          from the Account page in the app or on the website; this permanently removes your account, your
          disclosures, comments, chat messages, votes and usage records straight away. See{' '}
          <Link href="/delete-account" className="text-accent-teal">how to delete your account</Link>.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If this policy changes, the new version will be posted here with a new date. Questions or requests:{' '}
          <a href={`mailto:${CONTACT}`} className="text-accent-teal">{CONTACT}</a>.
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
