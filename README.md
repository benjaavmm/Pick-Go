# Pick&Go

**Pides. Retiras. Te vas.** Pick&Go es una app para estudiantes de universidades e institutos de Chile: pides en los
locales de tu sede, eliges a qué hora retiras y el local recibe el pedido al instante para tenerlo listo a esa hora.
Así no pierdes en la fila los 10 minutos que tienes para comer.

| Inicio | Carrito y hora de retiro | Pedido listo |
| --- | --- | --- |
| ![Inicio](docs/home.png) | ![Carrito](docs/carrito.png) | ![Pedido listo](docs/pedido-listo.png) |

| Panel del local | Panel de la institución |
| --- | --- |
| ![Panel del local](docs/panel.png) | ![Panel de la institución](docs/institucion.png) |

## Qué hace

**Estudiantes**

- Registro con correo y sede; las sedes se agrupan por institución.
- Locales ordenados por la hora más cercana en que se puede retirar, con buscador de productos.
- Hora de retiro en franjas de 10 minutos, para hoy o mañana. Cada franja tiene cupo, así la demanda del horario
  peak se reparte.
- Pago con tarjeta, tarjeta JUNAEB o efectivo al retirar (ver [Limitaciones](#limitaciones)).
- Seguimiento en vivo y aviso cuando el pedido está listo, también con la app cerrada.
- Código de retiro con QR, historial, «pedir lo de siempre» y calificación del local.
- Perfil con cambio de sede, apariencia clara u oscura, ayuda, descarga de datos y eliminación de cuenta.

**Locales**

- Tablero en vivo con los pedidos ordenados por hora de retiro y aviso sonoro al entrar uno nuevo.
- Un botón por paso: empezar a preparar, avisar que está listo y entregar. Se entrega escaneando el QR con la cámara
  o escribiendo el código.
- Menú editable, horarios, cupo por franja, anticipación mínima y pausa de pedidos.
- Métricas: ventas, puntualidad, calificación, demanda por hora, productos más pedidos y opiniones.
- Si un pedido no se retira, se marca; con dos en 30 días, ese estudiante debe pagar al pedir.

**Instituciones**

- Resumen con pedidos, puntualidad, ventas y satisfacción, por sede y por período, exportable a CSV.
- Aprobación de locales: un local nuevo no aparece para los estudiantes hasta que la institución lo aprueba.
- Creación de sedes.

## Cómo correrlo

Necesitas [Node.js](https://nodejs.org) 22.13 o superior.

```bash
npm install
```

```bash
npm run dev
```

Abre <http://localhost:5173>. La primera vez se crea la base de datos con datos de demostración, incluido un
historial de pedidos de la última semana para que las métricas tengan contenido.

La pantalla de ingreso tiene botones para entrar con las cuentas de prueba. Todas usan la contraseña `pickgo123`:

| Rol | Correo |
| --- | --- |
| Estudiante | `estudiante@pickgo.cl` |
| Local (Pronto Copec) | `copec@pickgo.cl` |
| Local (Pepepug) | `pepepug@pickgo.cl` |
| Local (Casino) | `casino@pickgo.cl` |
| Institución (Duoc UC) | `admin@pickgo.cl` |

Para ver los avisos en vivo, abre el estudiante y el local en ventanas distintas (una de incógnito).

Los avisos push y la instalación como app solo funcionan en la versión compilada (`npm run build` y `npm start`)
y con HTTPS o en `localhost`.

### Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor y app web en modo desarrollo |
| `npm test` | Pruebas del servidor |
| `npm run build` | Revisa tipos y compila la app web en `dist/` |
| `npm start` | Sirve la API y la app compilada en un solo puerto (3001) |
| `npm run crear-admin -- "Institución" correo@institucion.cl` | Crea una institución y su cuenta de administración |

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `PORT` | `3001` | Puerto del servidor |
| `PICKGO_DB` | `data/pickgo.db` | Archivo de la base de datos SQLite |
| `PICKGO_DEMO` | activado | Con `0` arranca sin datos ni cuentas de demostración |
| `TRUST_PROXY` | sin definir | Defínela si el servidor queda detrás de un proxy con HTTPS |
| `PICKGO_VAPID_SUBJECT` | `mailto:soporte@example.com` | Contacto del operador que exigen los servicios de push; usa uno real en producción |

## Publicarla

El archivo `render.yaml` permite publicarla en [Render](https://render.com): crea un Web Service desde este
repositorio y Render toma los comandos y variables de ahí. En el plan gratuito el servicio se duerme tras 15 minutos
sin uso y los datos se reinician al despertar; para conservar datos hace falta un plan con disco persistente y
apuntar `PICKGO_DB` a ese disco.

## Cómo está hecho

- **`server/`**: API en Node.js con Express y SQLite (`node:sqlite`, sin dependencias nativas). Los avisos en vivo
  usan Server-Sent Events y las notificaciones con la app cerrada usan Web Push.
- **`src/`**: app web en React y TypeScript, compilada con Vite. Es instalable (PWA) y está pensada para el celular.

Las horas de retiro se calculan siempre en hora de Chile. El servidor valida precios, disponibilidad, horarios y
cupos al crear cada pedido, así que no depende de lo que mande el navegador.

### Seguridad

- Contraseñas guardadas con scrypt; se rechazan las más comunes.
- Sesiones en cookie `HttpOnly` y `SameSite`; en la base solo se guarda el hash del token.
- Bloqueo de la cuenta tras 8 intentos fallidos y topes de solicitudes.
- Las acciones solo se aceptan desde la propia app (verificación de origen contra CSRF).
- Política de seguridad de contenido (CSP) estricta y cabeceras contra incrustación y detección de tipos.
- Cada rol accede solo a lo suyo: un local no ve pedidos de otro y una institución no ve locales de otra.
- Cambiar la contraseña cierra las demás sesiones; el estudiante puede descargar sus datos y eliminar su cuenta.
- Las suscripciones push solo se aceptan de los servicios de notificación de los navegadores.

## Limitaciones

Esta versión es un MVP para demostración. Lo que falta para operar con locales reales:

- **Los pagos son simulados.** Tarjeta y JUNAEB marcan el pedido como pagado sin cobrar nada. Integrar Webpay
  requiere credenciales de comercio de Transbank.
- **No hay verificación de correo ni recuperación de contraseña.** Ambas necesitan un servicio de envío de correos.
- **Las notificaciones push no se han probado en dispositivos reales**, y la app no se ha probado en iPhone ni
  Safari; las pruebas automáticas corren en Chromium.
- **En iPhone los avisos push exigen instalar la app** en la pantalla de inicio (requisito de iOS).
- **Los productos no tienen fotos ni opciones** (tamaños, agregados); usan un ícono.
- **Un solo servidor con SQLite.** Sirve para pilotos; para muchas sedes a la vez conviene pasar a una base de datos
  administrada.
- Los menús, precios e historial de demostración son inventados.

Quedaron fuera, igual que en el informe del proyecto: lockers inteligentes, predicción de demanda, programa de
puntos y entrega dentro del campus.
