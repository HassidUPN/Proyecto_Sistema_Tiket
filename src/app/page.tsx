import Link from 'next/link';

const routes = [
  { href: '/kiosco', label: 'Kiosco' },
  { href: '/cajero/1', label: 'Cajero' },
  { href: '/pantalla-publica', label: 'Pantalla Pública' },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-4xl rounded-3xl bg-white p-8 shadow-lg">
        <h1 className="text-3xl font-bold text-slate-900">Sistema de Turnos Bancarios</h1>
        <p className="mt-3 text-slate-600">Panel principal del sistema.</p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className="rounded-2xl bg-slate-900 px-6 py-5 text-center text-lg font-semibold text-white transition hover:bg-slate-700"
            >
              {route.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
