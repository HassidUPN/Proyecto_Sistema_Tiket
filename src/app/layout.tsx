import './globals.css';

export const metadata = {
  title: 'Sistema de Turnos Bancarios',
  description: 'Kiosco para emisión de tickets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
