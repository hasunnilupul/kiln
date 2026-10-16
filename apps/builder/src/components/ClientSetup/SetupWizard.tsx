'use client'

import dynamic from 'next/dynamic'
import React from 'react'

import type { WizardProps } from './Wizard'

// Client-only: the wizard restores unsaved work from localStorage while it initialises.
const Wizard = dynamic(() => import('./Wizard').then((module) => module.Wizard), {
  ssr: false,
  loading: () => <p>Loading the setup wizard…</p>,
})

/** Remounts the wizard from the saved config whenever a new version is saved. */
export function SetupWizard(props: WizardProps) {
  return <Wizard key={props.latest?.version ?? 0} {...props} />
}
