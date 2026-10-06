'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(!!localStorage.getItem('exithreat_token'));
  }, []);

  return (
    <div className="flex flex-col gap-10">
      {/* Hero */}
      <section className="flex flex-col items-center text-center gap-5 pt-8">
        <div className="text-5xl font-mono font-black text-accent-red tracking-tight">
          ExiThreat
        </div>
        <p className="text-gray-400 font-mono text-sm max-w-md leading-relaxed">
          A secure, anonymous platform for disclosing workplace abuses. Your story
          travels through isolated peer groups — never public, always protected.
        </p>
        <div className="flex gap-3 mt-2">
          {isLoggedIn ? (
            <>
              <Link
                href="/post/new"
                className="px-6 py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm hover:bg-accent-red/80 transition-colors no-underline"
              >
                + New Disclosure
              </Link>
              <Link
                href="/groups"
                className="px-6 py-3 border border-accent-teal text-accent-teal rounded-lg font-mono font-bold text-sm hover:bg-accent-teal/10 transition-colors no-underline"
              >
                My Groups
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/auth/register"
                className="px-6 py-3 bg-accent-red text-white rounded-lg font-mono font-bold text-sm hover:bg-accent-red/80 transition-colors no-underline"
              >
                Get Started
              </Link>
              <Link
                href="/auth/login"
                className="px-6 py-3 border border-gray-700 text-gray-300 rounded-lg font-mono font-bold text-sm hover:border-gray-500 transition-colors no-underline"
              >
                Sign In
              </Link>
            </>
          )}
        </div>
        {!isLoggedIn && (
          <Link href="/law-enforcement" className="text-xs font-mono text-gray-500 hover:text-accent-teal transition-colors">
            Law enforcement sign in
          </Link>
        )}
      </section>

      {/* How it works */}
      <section className="grid grid-cols-1 gap-4">
        {[
          {
            icon: '🔒',
            title: 'First-Look Protection',
            body: 'Each member views unredacted content exactly once via a secure image strip. After that, only the redacted version is visible.',
          },
          {
            icon: '▲',
            title: 'Democratic Push Engine',
            body: 'When ≥50% of a group votes to Push, the content moves to a new random group. No AI sentiment — pure collective consensus.',
          },
          {
            icon: '⚖',
            title: 'Credibility Weightage',
            body: "Each group's push percentage accumulates into a total weight score, quantifying how many people validated the story.",
          },
          {
            icon: '💬',
            title: 'Tagged Comments Travel',
            body: 'Comments you leave are tagged and move with the content. Group chat stays local and is never exported.',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="flex gap-4 p-4 bg-navy-800 rounded-xl border border-gray-800"
          >
            <div className="text-2xl flex-shrink-0">{item.icon}</div>
            <div>
              <div className="font-mono font-bold text-sm text-accent-teal mb-1">
                {item.title}
              </div>
              <div className="font-mono text-xs text-gray-400 leading-relaxed">{item.body}</div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
