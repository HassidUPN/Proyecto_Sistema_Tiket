const {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require('docx');
const fs = require('fs');
const path = require('path');

const blue = '2563EB';
const paleBlue = 'EFF6FF';
const paleGreen = 'ECFDF5';
const gray = '475569';

const title = (text) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 260, after: 120 },
  children: [new TextRun({ text, bold: true, color: blue, size: 30 })],
});

const subtitle = (text) => new Paragraph({
  spacing: { after: 180 },
  children: [new TextRun({ text, color: gray, size: 22 })],
});

const bullet = (text) => new Paragraph({
  bullet: { level: 0 },
  spacing: { after: 70 },
  children: [new TextRun({ text, size: 21 })],
});

const cell = (text, fill = 'FFFFFF', bold = false) => new TableCell({
  shading: { fill, type: ShadingType.CLEAR },
  margins: { top: 100, bottom: 100, left: 130, right: 130 },
  children: [new Paragraph({ children: [new TextRun({ text, bold, size: 19 })] })],
});

const table = (headers, rows) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' } },
  rows: [
    new TableRow({ children: headers.map((header) => cell(header, paleBlue, true)) }),
    ...rows.map((row) => new TableRow({ children: row.map((value) => cell(value)) })),
  ],
});

const doc = new Document({
  creator: 'Sistema de Turnos Bancarios',
  title: 'Presentacion del Sistema de Turnos Bancarios',
  description: 'Documento de apoyo para la exposicion del proyecto',
  sections: [{
    properties: { page: { margin: { top: 850, right: 900, bottom: 850, left: 900 } } },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 1700, after: 260 }, children: [new TextRun({ text: 'SISTEMA DE TURNOS BANCARIOS', bold: true, color: blue, size: 38 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 700 }, children: [new TextRun({ text: 'Documento de apoyo para exposicion', color: gray, size: 25 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, shading: { fill: paleBlue, type: ShadingType.CLEAR }, spacing: { before: 300, after: 300 }, children: [new TextRun({ text: 'Gestion de tickets, estaciones y atencion al cliente', bold: true, color: '0F172A', size: 24 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 900 }, children: [new TextRun({ text: 'Tecnologias: Next.js, React, TypeScript, Tailwind CSS, Supabase y Vercel', color: gray, size: 20 })] }),
      new Paragraph({ children: [new PageBreak()] }),

      title('1. Descripcion del proyecto'),
      subtitle('Sistema web para organizar la atencion de clientes en una oficina bancaria.'),
      bullet('El cliente obtiene un ticket desde un kiosco.'),
      bullet('El cajero llama el siguiente ticket desde su caja o cubiculo.'),
      bullet('La pantalla publica muestra el ticket y la estacion que lo atendera.'),
      bullet('El administrador configura las estaciones y consulta estadisticas.'),

      title('2. Problema que resuelve'),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'El sistema evita filas desordenadas y mejora la comunicacion entre clientes y personal. Cada ticket queda registrado, se puede rastrear y se utiliza para obtener indicadores de rendimiento.', size: 21 })] }),

      title('3. Tecnologias utilizadas'),
      table(['Tecnologia', 'Uso en el proyecto'], [
        ['Next.js', 'Framework principal y rutas de la aplicacion.'],
        ['React', 'Construccion de las interfaces interactivas.'],
        ['TypeScript', 'Tipos y validacion de datos.'],
        ['Tailwind CSS', 'Diseño visual responsive.'],
        ['Supabase / PostgreSQL', 'Base de datos, funciones RPC y datos en tiempo real.'],
        ['Vercel', 'Despliegue de la aplicacion en Internet.'],
      ]),

      title('4. Modulos principales'),
      table(['Modulo', 'Funcion'], [
        ['/kiosco', 'Emite tickets segun tramite y perfil del cliente.'],
        ['/accesos', 'Muestra cajas y cubiculos abiertos para acceder a cada puesto.'],
        ['/cajero/[stationId]', 'Permite llamar, marcar ausente y finalizar tickets.'],
        ['/pantalla-publica', 'Muestra llamado actual, proximos tickets y ultimos atendidos.'],
        ['/admin', 'Abre jornadas, configura estaciones y muestra el dashboard.'],
      ]),

      new Paragraph({ children: [new PageBreak()] }),
      title('5. Flujo de funcionamiento'),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '1. El administrador abre la jornada y define las estaciones disponibles.', size: 21 })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '2. El cliente selecciona un tramite y su perfil en el kiosco.', size: 21 })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '3. El sistema genera un codigo y registra el ticket como WAITING.', size: 21 })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '4. El cajero llama el ticket; pasa a CALLING y se registra la hora.', size: 21 })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '5. La pantalla publica muestra el ticket y la caja o cubiculo.', size: 21 })] }),
      new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: '6. El cajero finaliza la atencion o marca al cliente como ausente.', size: 21 })] }),

      title('6. Estados de un ticket'),
      table(['Estado', 'Significado'], [
        ['WAITING', 'El cliente espera ser llamado.'],
        ['CALLING', 'El ticket fue llamado y esta asociado a una estacion.'],
        ['IN_PROGRESS', 'La atencion esta en proceso.'],
        ['COMPLETED', 'La atencion termino correctamente.'],
        ['ABSENT', 'El cliente no se presento al llamado.'],
      ]),

      title('7. Base de datos'),
      bullet('tickets: almacena codigo, perfil, servicio, estado, estacion y tiempos.'),
      bullet('stations: almacena cajas y cubiculos, su etiqueta y si estan activos.'),
      bullet('workday_sessions: registra la apertura y cierre de cada jornada.'),
      bullet('daily_sequence: controla la numeracion diaria de tickets.'),
      bullet('priority_state: conserva el estado de prioridad de los perfiles.'),

      title('8. Estadisticas'),
      bullet('Clientes llamados, atendidos, ausentes y pendientes.'),
      bullet('Tiempo de espera: created_at hasta called_at.'),
      bullet('Tiempo de atencion: started_at hasta completed_at.'),
      bullet('Atenciones y promedio por caja o cubiculo.'),

      title('9. Actualizacion y sonido'),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'La aplicacion combina Supabase Realtime con consultas periodicas de respaldo. Cuando aparece un nuevo llamado, la pantalla publica reproduce una notificacion una sola vez por ticket. El archivo de sonido se ubica en public/sounds/notificacion.mp3.', size: 21 })] }),

      title('10. Estado actual y mejoras futuras'),
      new Paragraph({ shading: { fill: paleGreen, type: ShadingType.CLEAR }, spacing: { after: 120 }, children: [new TextRun({ text: 'Estado actual: proyecto compilado, probado en navegador, conectado a Supabase y preparado para Vercel.', bold: true, size: 21 })] }),
      bullet('Agregar autenticacion para proteger administrador y cajeros.'),
      bullet('Configurar impresion directa con Chrome en modo kiosk.'),
      bullet('Agregar reportes historicos y filtros avanzados.'),
      bullet('Usar un servicio externo para automatizar tickets ausentes en Vercel Hobby.'),

      title('11. Exposicion breve'),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: 'Nuestro proyecto es un sistema web de turnos bancarios desarrollado con Next.js, React, TypeScript, Tailwind CSS y Supabase. El cliente genera un ticket desde el kiosco, el cajero lo llama desde su estacion y la pantalla publica muestra el numero y el lugar de atencion. Ademas, el administrador puede configurar las cajas y cubiculos, abrir la jornada y consultar estadisticas de atencion. Finalmente, Vercel permite publicar el sistema en Internet.', size: 22 })] }),
    ],
  }],
});

const output = path.resolve(__dirname, '..', 'Presentacion_Sistema_Turnos_Bancarios.docx');
Packer.toBuffer(doc).then((buffer) => {
  fs.writeFileSync(output, buffer);
  console.log(output);
});
