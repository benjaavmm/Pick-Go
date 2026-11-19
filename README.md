# ToruGo

**Pide entre clases. Retira sin fila.** ToruGo es una app para estudiantes de universidades e institutos de Chile: pides
en los locales de tu sede, retiras justo en tu recreo y el local recibe el pedido al instante para tenerlo listo a esa
hora. Así no pierdes en la fila los 10 minutos que tienes para comer.

Lo que la distingue:

- **Calza con tus recreos.** Si el estudiante guarda sus recreos, la app le propone retirar dentro del próximo y marca
  las horas que calzan. Si no los guarda, elige la hora que quiera.
- **Varios medios de pago.** En la app, en el local o con Junaeb al retirar, según lo que acepte cada local.
- **Descuentos de ToruGo.** Las promociones y la tarjeta de sellos las define y las paga la plataforma con su
  comisión: el local recibe siempre el precio completo.
- **Paneles para el local, la institución y la plataforma** con ventas, puntualidad, fila evitada y clientes.

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
- Productos con foto y opciones (tamaños, agregados), con el precio calculado al elegir.
- **Mis recreos**: guarda tus recreos (días y horario) y al pedir te proponemos retirar dentro del próximo; las horas
  que calzan se marcan en el carrito y el inicio muestra cuánto falta para tu recreo.
- Pago en la app al confirmar el pedido: el local lo recibe recién cuando el pago se aprueba, y si lo rechaza o el
  estudiante cancela a tiempo, el dinero se devuelve solo. Cada local decide si también acepta pagar al retirar, en
  efectivo o con Junaeb (ver «Pagar al retirar» y «Junaeb»).
- Seguimiento en vivo y aviso cuando el pedido está listo, también con la app cerrada.
- Código de retiro con QR, historial, «pedir lo de siempre» y calificación del local.
- Promociones de ToruGo por hora de retiro, tarjeta de sellos con premio y favoritos.
- Perfil con cambio de sede, apariencia clara u oscura, ayuda, descarga de datos y eliminación de cuenta.

**Locales**

- Tablero en vivo con los pedidos ordenados por hora de retiro y aviso sonoro al entrar uno nuevo.
- Un botón por paso: empezar a preparar, avisar que está listo y entregar. Se entrega escaneando el QR con la cámara
  o escribiendo el código.
- Cada pedido nuevo se acepta o se rechaza con un motivo; el estudiante se entera al instante. También hay
  aceptación automática.
- Tablero pensado para una tablet en el mostrador: la pantalla no se apaga y la alerta suena hasta aceptar.
- Días de atención por local, impresión de comandas y descarga de pedidos en CSV (con el medio de pago).
- Junaeb: el local la activa si está adherido al operador de su sede. Al entregar, la app muestra el monto y cómo
  cobrarlo, y el local confirma si se cobró con Junaeb o con otro medio.
- En los pedidos que se pagan al retirar, el local ve el historial del cliente (pedidos retirados y no retirados).
- Panel «Lo que ganaste con ToruGo»: ventas por la app, pedidos en horas peak, fila evitada (estimada),
  clientes nuevos y recurrentes, y pedidos no retirados que igual se cobraron.
- Tiempo de preparación por producto e impresión automática de la comanda al aceptar.
- Menú editable con foto, ícono y opciones por producto (todos opcionales), horarios, cupo por franja,
  anticipación mínima y pausa de pedidos.
- Métricas: ventas, puntualidad, calificación, demanda por hora, productos más pedidos y opiniones.
- Si un pedido no se retira, se marca; con tres en 30 días, esa cuenta no puede hacer pedidos nuevos.

**Instituciones**

- Resumen con pedidos, puntualidad, ventas y satisfacción, por sede y por período, exportable a CSV.
- Aprobación de locales: un local nuevo no aparece para los estudiantes hasta que la institución lo aprueba.
- Creación de sedes, con el operador de la beca Junaeb de cada una (se puede corregir si Junaeb lo cambia).

**Plataforma** (quien opera ToruGo)

- Define la comisión, ve cuánto transferir a cada local y registra cada transferencia; el local ve el detalle.
- **Locales**: define las promociones y la tarjeta de sellos de cada local, ve cuánto pone en descuentos frente a lo
  que gana en comisiones, y la calidad de servicio de cada local (puntualidad, cancelados, no retirados,
  calificación).
- Crea instituciones con su primera sede y su cuenta de administración.
- Recupera el acceso de quien olvidó su contraseña, con una clave temporal.

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

La pantalla de ingreso tiene botones para entrar con las cuentas de prueba. Todas usan la contraseña `torugo123`:

| Rol | Correo |
| --- | --- |
| Estudiante (con beca y recreos guardados) | `estudiante@torugo.cl` |
| Local (Café Andén, recibe la beca) | `cafe@torugo.cl` |
| Local (La Sanguchería) | `sangucheria@torugo.cl` |
| Local (Casino, recibe la beca) | `casino@torugo.cl` |
| Institución (Duoc UC) | `admin@torugo.cl` |
| Plataforma | `plataforma@torugo.cl` |

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
| `npm run crear-admin -- "Institución" correo@institucion.cl` | Crea una institución y su administración desde la terminal |

### Variables de entorno

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `PORT` | `3001` | Puerto del servidor |
| `TORUGO_DB` | `data/torugo.db` | Archivo de la base de datos SQLite |
| `TORUGO_DEMO` | activado | Con `0` arranca sin datos ni cuentas de demostración |
| `TORUGO_OWNER_EMAIL` y `TORUGO_OWNER_PASSWORD` | sin definir | Crean la cuenta de plataforma al arrancar, si no existe |
| `TORUGO_SMTP_URL` | sin definir | Servidor de correo, por ejemplo `smtps://usuario:clave@smtp.proveedor.com` |
| `TORUGO_MAIL_FROM` | sin definir | Remitente, por ejemplo `ToruGo <no-responder@tudominio.cl>` |
| `TORUGO_PUBLIC_URL` | sin definir | Dirección pública de la app, para los enlaces de los correos |

Las variables con los nombres anteriores de la app (`GOBITE_*` y `PICKGO_*`) se siguen aceptando: si falta la
`TORUGO_*`, se usa la antigua y el servidor avisa en el registro. Del mismo modo, si todavía no hay `data/torugo.db`
pero existe `data/gobite.db` o `data/pickgo.db`, se sigue usando la base anterior.

Con las tres variables de correo definidas se activan la recuperación de contraseña por correo y los avisos a la
institución (local nuevo por aprobar) y al local (aprobado o suspendido). Sin ellas, la app funciona igual y la
plataforma recupera accesos con contraseñas temporales.
| `TRUST_PROXY` | sin definir | Defínela si el servidor queda detrás de un proxy con HTTPS |
| `TORUGO_VAPID_SUBJECT` | `mailto:soporte@example.com` | Contacto del operador que exigen los servicios de push; usa uno real en producción |

## Cobro en la app

El dinero de los pedidos pagados en la app entra a la cuenta de quien opera ToruGo. La app calcula la comisión de
cada pedido y, en **Plataforma → Pagos**, muestra cuánto transferir a cada local; al registrar la transferencia, el
local la ve con su detalle. Se liquida lo entregado y lo no retirado; lo cancelado se devuelve al estudiante.

| `TORUGO_PAYMENTS` | Qué hace |
| --- | --- |
| sin definir | Sin cobro en la app: todo se paga en el local (con datos de demostración se usa `simulado`) |
| `simulado` | **Marcha blanca**: flujo completo con una pantalla de pago de prueba. No se mueve dinero |
| `mercadopago` | Cobro real con Mercado Pago Checkout Pro, con la API de Orders (`/v1/orders`) |

Para Mercado Pago define además `TORUGO_MP_ACCESS_TOKEN` (de tu cuenta de Mercado Pago Developers; las credenciales
de prueba permiten pagar con tarjetas de prueba), `TORUGO_PUBLIC_URL` (dirección `https://` pública de la app, a la
que Mercado Pago envía los avisos de pago) y, recomendado, `TORUGO_MP_WEBHOOK_SECRET` (la firma secreta de las
notificaciones). En el panel de Mercado Pago, en Configuración de Webhooks, usa la URL
`https://TU-DIRECCION/api/payments/webhook` con el evento **Order (Mercado Pago)**. La app nunca confía en lo que diga el navegador ni el aviso: siempre vuelve a consultar el pago a
Mercado Pago y revisa que el monto coincida.

Ten en cuenta que Mercado Pago cobra su propia comisión a tu cuenta: la comisión de ToruGo debe cubrirla.

## Quién decide qué

- **El local decide su operación**: menú, precios, horarios, cupo por franja, anticipación, pausar, y aceptar o
  rechazar cada pedido con un motivo. Es quien cocina: si la app le quitara esas decisiones, prometería horas que no
  puede cumplir.
- **ToruGo decide lo comercial**: la comisión, las promociones y la tarjeta de sellos. Y ve la calidad de cada local
  en **Plataforma → Locales**. La institución puede suspender un local que no cumpla.

## Descuentos (promociones y sellos)

Los define la plataforma en **Plataforma → Locales → Descuentos**, y los paga con su comisión. El local no los
configura y recibe siempre el precio completo:

- **Pagado en la app**: el estudiante paga el precio con descuento; la comisión se calcula sobre el precio completo y
  el local recibe el precio completo menos la comisión. ToruGo se queda con la comisión menos el descuento.
- **Pagado al retirar** (efectivo o Junaeb): el local cobra el precio con descuento en el mesón y ToruGo le abona la
  diferencia en la siguiente liquidación.

Ejemplo con comisión de 8 % y una promoción de 10 % sobre un menú de $4.000: el estudiante paga $3.600, el local
recibe $3.680 y ToruGo pone $80. Si una promoción supera la comisión, el panel lo advierte. Los descuentos de los
pedidos anteriores a este cambio los había puesto el local y no se abonan.

## Pagar al retirar

Un local que acepta pagos al retirar prepara algo que todavía no está pagado. Es lo mismo que el pago contra entrega
de las apps de delivery, y se resuelve igual que ellas: limitando el riesgo, en vez de obligar al estudiante a ir dos
veces (una a pagar y otra a buscar).

- Cada estudiante puede tener **un solo pedido sin pagar a la vez**. Lo más que arriesga un local es un pedido.
- Quien deja un pedido sin retirar **solo puede pagar en la app durante 30 días**. Con tres sin retirar en 30 días no
  puede hacer pedidos nuevos.
- En esos pedidos el local ve el **historial del cliente** y decide si lo acepta.
- Cada local decide si acepta pagos al retirar (efectivo y Junaeb, por separado). Si no quiere ese riesgo, recibe
  solo pedidos pagados en la app.

Estas reglas aplican cuando el cobro en la app está activado; sin él, todos los pedidos se pagan al retirar.

## Junaeb (BAES)

**La beca no se puede cobrar dentro de la app.** Junaeb entrega la beca a través de operadores privados (Edenred en
regiones y Pluxee en la Región Metropolitana, en 2026), y ninguno ofrece una integración pública para que una app
externa cobre la beca. Por eso la beca se paga en el mesón del local, y la app se encarga de que eso tome segundos:

1. El estudiante elige «Junaeb al retirar» en un local adherido. El pedido llega al local igual que cualquier
   otro y se prepara para su hora.
2. Cuando está listo, el aviso le dice qué app abrir y cuánto va a pagar. En el pedido ve los pasos según su operador
   (Ticket Junaeb: «Pagar», clave y código QR; Pluxee: «Pago QR» y PIN).
3. Al entregar, el local verifica el código de retiro, cobra el monto exacto con el sistema de su operador y confirma
   en la app si se cobró con la beca o con otro medio (por ejemplo, si no tenía saldo).

El operador se guarda **por sede** y se deduce de la ciudad al crearla (comunas de la Región Metropolitana: Pluxee; el
resto: Edenred). Como Junaeb lo licita y ya cambió en la Región Metropolitana en 2025, la institución lo puede
corregir en **Sedes**. Cada local activa la beca en **Ajustes** solo si está adherido al operador de su sede; la
adhesión se hace directamente con Edenred o Pluxee.

Lo cobrado con la beca no pasa por la plataforma: el dinero le llega al local desde el operador. Solo entra a las
liquidaciones el abono de los descuentos de ToruGo, igual que en los demás pagos al retirar. La app no guarda el RUT, la clave ni el saldo del estudiante.

Si algún día un operador abre una integración para plataformas (enlace de pago o API), `server/payments.js` ya está
pensado para sumar otro proveedor de cobro, como se sumó Mercado Pago.

## Operar con instituciones reales

1. Arranca con `TORUGO_DEMO=0` y define `TORUGO_OWNER_EMAIL` y `TORUGO_OWNER_PASSWORD`. La base parte vacía, con
   solo tu cuenta de plataforma.
2. Entra con esa cuenta y crea la institución: la app te muestra una vez el correo y la contraseña temporal de su
   administración.
3. La administración entra, cambia su contraseña y crea las sedes que falten.
4. Cada local se registra solo desde «Súmalo a ToruGo» y la administración lo aprueba.
5. Los estudiantes se registran solos eligiendo su sede.

La base de datos es un archivo SQLite (`TORUGO_DB`). Cada día se guarda una copia en la carpeta `respaldos`, junto
a la base, y se conservan las últimas siete. Guarda ese archivo en un disco que no se borre.

También hay un `Dockerfile` para correrla en cualquier servicio de contenedores; la base vive en `/data`, donde hay
que montar un volumen persistente.

## Publicarla

El archivo `render.yaml` permite publicarla en [Render](https://render.com). Tal como viene usa el plan gratuito con
datos de demostración, que **se pierden cada vez que el servicio se duerme**: sirve para mostrar la app, no para
operar. Para conservar cuentas y pedidos hace falta un plan con disco persistente; el mismo archivo explica qué
líneas activar.

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

Lo que falta o conviene saber antes de operar a gran escala:

- **Mercado Pago:** probado de punta a punta contra Mercado Pago real con credenciales de prueba (crear, reabrir,
  pagar con tarjeta de prueba, aprobar, devolver y cancelar). Los avisos por webhook se prueban una vez publicada,
  porque Mercado Pago necesita una dirección pública.
- **Las transferencias a los locales se hacen a mano.** La app calcula los montos y lleva el registro, pero el dinero
  lo transfiere quien opera la plataforma. Para que llegue directo a cada local hace falta el pago dividido del
  proveedor (marketplace).
- **Boletas y facturas no se emiten desde la app.** Cómo documentar las ventas y la comisión hay que definirlo con
  un contador.
- **No se verifica que el correo sea del estudiante** al registrarse. La recuperación de contraseña por correo ya
  existe, pero requiere configurar un servicio de envío (SMTP).
- **Las notificaciones push no se han probado en dispositivos reales**, y la app no se ha probado en iPhone ni
  Safari; las pruebas automáticas corren en Chromium.
- **En iPhone los avisos push exigen instalar la app** en la pantalla de inicio (requisito de iOS).
- **Un solo servidor con SQLite.** Sirve para pilotos; para muchas sedes a la vez conviene pasar a una base de datos
  administrada.
- **La beca Junaeb se paga en el local**, no en la app (ver arriba). La app no puede comprobar si el estudiante tiene
  beca ni su saldo: si no pasa, paga con otro medio.
- Los locales, menús, precios e historial de demostración son inventados.

Quedaron fuera por ahora: lockers inteligentes, predicción de demanda y entrega dentro del campus.
