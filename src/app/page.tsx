import Link from 'next/link';

const routes = [
  { href: '/admin', label: 'Administrador' },
  { href: '/kiosco', label: 'Kiosco' },
  { href: '/accesos', label: 'Accesos de estaciones' },
  { href: '/pantalla-publica', label: 'Pantalla Pública' },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white p-4 text-slate-800 sm:p-8">
      <div className="mx-auto max-w-5xl rounded-[2rem] border border-sky-100 bg-white p-8 shadow-[0_20px_80px_rgba(125,160,190,0.16)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-blue-700">Banco</p>
            <h1 className="mt-3 text-4xl font-black text-slate-900">Sistema de Turnos Bancarios</h1>
          </div>
          <div className="rounded-full bg-sky-100 px-4 py-2 text-sm font-semibold text-sky-800">
            Panel principal
          </div>
        </div>

        <p className="mt-5 max-w-2xl text-lg text-slate-600">
          Gestiona el flujo completo desde el kiosco, la atención del cajero y la pantalla pública.
        </p>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className="group rounded-[1.5rem] border border-sky-100 bg-sky-50 px-6 py-6 text-center text-lg font-semibold text-sky-950 shadow-sm transition duration-200 hover:-translate-y-1 hover:border-sky-300 hover:bg-sky-100 hover:shadow-lg"
            >
              <span className="block text-xl font-bold">{route.label}</span>
              <span className="mt-2 block text-sm text-slate-500 transition group-hover:text-sky-800">
                Abrir módulo
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
