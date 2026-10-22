import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Brand = 'studio' | 'campus';
const BRAND_KEY = 'b20.design.edition';
const ThemeContext = createContext<{ brand: Brand; setBrand: (brand: Brand) => void }>({
  brand: 'studio',
  setBrand: () => {},
});

function initialBrand(): Brand {
  const query = new URLSearchParams(window.location.search).get('theme');
  if (query === 'campus' || query === 'studio') return query;
  try {
    const stored = localStorage.getItem(BRAND_KEY);
    if (stored === 'campus' || stored === 'studio') return stored;
  } catch {
    /* Storage is optional for the visual preference. */
  }
  return import.meta.env.VITE_BRAND === 'campus' ? 'campus' : 'studio';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<Brand>(initialBrand);
  useEffect(() => {
    document.documentElement.dataset.brand = brand;
    try {
      localStorage.setItem(BRAND_KEY, brand);
    } catch {
      /* Keep the current edition in memory. */
    }
  }, [brand]);
  return <ThemeContext value={{ brand, setBrand }}>{children}</ThemeContext>;
}

export function ThemeSwitch() {
  const { brand, setBrand } = useContext(ThemeContext);
  return (
    <div className="edition-switch" role="group" aria-label="Edición visual">
      <button type="button" aria-pressed={brand === 'studio'} onClick={() => setBrand('studio')}>
        Studio
      </button>
      <button type="button" aria-pressed={brand === 'campus'} onClick={() => setBrand('campus')}>
        Campus
      </button>
    </div>
  );
}
