'use client';

import React from 'react';
import Link from 'next/link';
import { 
  BellRing, 
  FileCheck, 
  Smartphone, 
  CheckCircle2, 
  ArrowRight, 
  AlertTriangle 
} from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Hero Section */}
      <section className="px-6 pt-20 pb-16 md:pt-28 md:pb-24 max-w-7xl mx-auto text-center" aria-labelledby="hero-heading">
        <div className="inline-flex items-center space-x-2 bg-blue-950/60 border border-blue-800/60 rounded-full px-4 py-1.5 mb-8 text-xs font-semibold text-blue-400 tracking-wide uppercase">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span>Prevent Expensive Job-Site Shutdowns</span>
        </div>

        <h1 id="hero-heading" className="text-4xl md:text-6xl font-extrabold tracking-tight text-white leading-tight max-w-4xl mx-auto">
          Never let an expired license or policy shut down your crew.
        </h1>

        <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl mx-auto font-normal">
          TradePass automatically monitors trade licenses, OSHA certs, and general liability insurance for your entire crew with 30-day SMS alerts before work stops.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link 
            href="/signup"
            className="w-full sm:w-auto flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-base px-8 py-4 rounded-xl shadow-xl shadow-blue-900/20 transition"
          >
            <span>Subscribe & Get Started</span>
            <ArrowRight className="w-5 h-5" />
          </Link>
          <a 
            href="#pricing"
            className="w-full sm:w-auto flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold text-base px-8 py-4 rounded-xl border border-slate-800 transition"
          >
            View Subscription Tiers
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Instant activation • Set up your account in under 3 minutes
        </p>
      </section>

      {/* Feature Cards Grid Section */}
      <section id="features" className="px-6 py-16 bg-slate-900/50 border-y border-slate-800/80" aria-labelledby="features-heading">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 id="features-heading" className="text-2xl md:text-3xl font-bold text-white">Built for Skilled Trade Contractors</h2>
            <p className="text-sm text-slate-400 mt-2">Everything you need to satisfy GCs and keep your operations moving.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <article className="bg-slate-950 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600/10 p-3 rounded-xl w-fit text-blue-400 mb-4 border border-blue-500/20">
                <BellRing className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">Automated SMS & Email Alerts</h3>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Receive warnings 30, 15, and 7 days before any license, workers&apos; comp policy, or safety cert expires.
              </p>
            </article>

            <article className="bg-slate-950 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600/10 p-3 rounded-xl w-fit text-blue-400 mb-4 border border-blue-500/20">
                <Smartphone className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">1-Click GC Passport Link</h3>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Text a single verified link to General Contractors showing your entire crew&apos;s up-to-date clearance.
              </p>
            </article>

            <article className="bg-slate-950 p-6 rounded-2xl border border-slate-800">
              <div className="bg-blue-600/10 p-3 rounded-xl w-fit text-blue-400 mb-4 border border-blue-500/20">
                <FileCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">Secure Cloud Storage</h3>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Keep high-resolution PDFs of master licenses, insurance binders, and OSHA cards instantly accessible.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="px-6 py-20 max-w-7xl mx-auto w-full" aria-labelledby="pricing-heading">
        <div className="text-center mb-14">
          <h2 id="pricing-heading" className="text-3xl font-bold text-white">Simple, Predictable Subscription Plans</h2>
          <p className="text-slate-400 mt-2">Select the plan that fits your crew size. Change or cancel anytime.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Tier 1: Standard Crew */}
          <article className="bg-slate-950 p-8 rounded-2xl border border-slate-800 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Standard Crew</h3>
              <p className="text-xs text-slate-400 mt-1">For independent trade contractors</p>
              <div className="mt-6 flex items-baseline">
                <span className="text-4xl font-extrabold text-white">$49</span>
                <span className="text-slate-400 text-sm font-medium ml-1">/ month</span>
              </div>
              <ul className="mt-8 space-y-4 text-sm text-slate-300">
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Up to 10 Worker Profiles</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Automated 30-Day Expiration Alerts</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Instant GC Passport Links</span>
                </li>
              </ul>
            </div>
            <Link 
              href="/signup?tier=standard"
              className="mt-8 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl border border-slate-700 text-center transition block"
            >
              Get Started
            </Link>
          </article>

          {/* Tier 2: Crew Pro (Featured) */}
          <article className="bg-slate-900 p-8 rounded-2xl border-2 border-blue-500 relative flex flex-col justify-between shadow-2xl shadow-blue-950/30">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
              Most Popular
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Crew Pro</h3>
              <p className="text-xs text-slate-400 mt-1">For active trade crews & sub-contractors</p>
              <div className="mt-6 flex items-baseline">
                <span className="text-4xl font-extrabold text-white">$79</span>
                <span className="text-slate-400 text-sm font-medium ml-1">/ month</span>
              </div>
              <ul className="mt-8 space-y-4 text-sm text-slate-300">
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Up to 25 Workers</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Priority 30/15/7-Day SMS Warnings</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Unlimited Document Vault Storage</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Shareable GC Public Passport Link</span>
                </li>
              </ul>
            </div>
            <Link 
              href="/signup?tier=pro"
              className="mt-8 w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl text-center shadow-lg transition block"
            >
              Subscribe Now
            </Link>
          </article>

          {/* Tier 3: Multi-Crew Enterprise */}
          <article className="bg-slate-950 p-8 rounded-2xl border border-slate-800 flex flex-col justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Multi-Crew Enterprise</h3>
              <p className="text-xs text-slate-400 mt-1">For growing commercial contractors</p>
              <div className="mt-6 flex items-baseline">
                <span className="text-4xl font-extrabold text-white">$149</span>
                <span className="text-slate-400 text-sm font-medium ml-1">/ month</span>
              </div>
              <ul className="mt-8 space-y-4 text-sm text-slate-300">
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Unlimited Workers & Staff</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Multiple Foreman Accounts</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Priority Support & Onboarding</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  <span>Custom Company Branding on Passports</span>
                </li>
              </ul>
            </div>
            <Link 
              href="/signup?tier=enterprise"
              className="mt-8 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl border border-slate-700 text-center transition block"
            >
              Get Started
            </Link>
          </article>

        </div>
      </section>

    </main>
  );
}