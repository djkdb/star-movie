import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export type PersistedStateBootstrap = () => Promise<unknown> | unknown;

export interface BootstrapApplicationOptions {
  rootElement: HTMLElement;
  application: ReactNode;
  bootstrapPersistedState: PersistedStateBootstrap;
}

export async function bootstrapApplication({
  rootElement,
  application,
  bootstrapPersistedState,
}: BootstrapApplicationOptions): Promise<void> {
  await bootstrapPersistedState();

  createRoot(rootElement).render(
    <StrictMode>{application}</StrictMode>,
  );
}
