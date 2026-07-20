import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TMDB_ATTRIBUTION_NOTICE, TmdbAttribution } from './TmdbAttribution';

afterEach(() => vi.unstubAllEnvs());

describe('TmdbAttribution', () => {
  it('shows the TMDB logo and required notice when a key is configured', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', 'test-key');
    render(<TmdbAttribution />);

    expect(screen.getByText(TMDB_ATTRIBUTION_NOTICE)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'TMDB' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /The Movie Database/ });
    expect(link).toHaveAttribute('href', 'https://www.themoviedb.org/');
  });

  it('renders nothing when no key is configured (TMDB is not in use)', () => {
    vi.stubEnv('VITE_TMDB_API_KEY', '');
    const { container } = render(<TmdbAttribution />);
    expect(container).toBeEmptyDOMElement();
  });
});
