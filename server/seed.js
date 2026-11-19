import { hashPassword } from './auth.js';
import { operatorForCity } from './baes.js';
import { BRAND } from './brand.js';
import { addDays, chileNow, hhmm } from './time.js';

export const DEMO_PASSWORD = 'torugo123';

// Datos de demostración. En la Sede Viña del Mar están los locales que los estudiantes más usan (Pronto Copec,
// Pepe Pug y el Casino). Sus colores se aproximan a los de cada marca y sus menús a lo que venden, pero los
// precios son de ejemplo: cada local real edita su menú, sus precios y sus colores desde su panel.
const DATA = [
  {
    institution: 'Duoc UC',
    campuses: [
      {
        name: 'Sede Viña del Mar',
        city: 'Viña del Mar',
        shops: [
          {
            name: 'Pepe Pug',
            email: 'pepepug@torugo.cl',
            description: 'Cafetería de paso: café, bubble tea y algo rico para el recreo',
            emoji: '🧋',
            location: 'Acceso Álvarez',
            opens: 480,
            closes: 1350,
            days: '123456',
            prep: 10,
            capacity: 6,
            baes: true,
            // Negro y café claro, como un pug.
            color: '#2b2420',
            color2: '#e3c39d',
            products: [
              ['Bubble tea', 'Bubble tea de leche', 'Té negro con leche y perlas de tapioca', 3200, '🧋'],
              ['Bubble tea', 'Bubble tea de frutas', 'Té verde con maracuyá o frutilla y perlas explosivas', 3300, '🧋'],
              ['Bubble tea', 'Taro latte', 'Leche con taro y perlas de tapioca', 3400, '🧋'],
              ['Bubble tea', 'Matcha latte frío', 'Matcha con leche y hielo', 3300, '🍵'],
              ['Café', 'Café americano', '350 ml', 1500, '☕'],
              ['Café', 'Capuccino', '300 ml', 2300, '☕'],
              ['Café', 'Latte de vainilla', '350 ml', 2600, '☕'],
              ['Café', 'Mokaccino', 'Café, chocolate y leche espumada', 2700, '☕'],
              ['Café', 'Frappé de moka', 'Café helado con chocolate y crema', 3400, '🥤'],
              ['Café', 'Chocolate caliente', '300 ml', 2200, '🍫'],
              ['Para comer', 'Croissant de jamón y queso', 'Tibio', 2400, '🥐'],
              ['Para comer', 'Sándwich de ave pimentón', 'En pan ciabatta', 3200, '🥪'],
              ['Para comer', 'Muffin de arándanos', 'Del día', 1600, '🧁'],
              ['Para comer', 'Brownie', 'Con nueces', 1500, '🍫'],
              ['Para comer', 'Galleta con chips', 'Grande', 1000, '🍪'],
              ['Para comer', 'Cheesecake de frambuesa', 'Porción', 2500, '🍰'],
              ['Bebidas', 'Jugo natural', 'Naranja o frutilla, 400 ml', 1900, '🧃'],
              ['Bebidas', 'Agua mineral', 'Con o sin gas, 500 ml', 1000, '💧'],
            ],
          },
          {
            name: 'Pronto Copec',
            email: 'copec@torugo.cl',
            description: 'Completos, sándwiches, café de grano y algo para picar',
            emoji: '🌭',
            location: 'Frente a la sede',
            opens: 450,
            closes: 1290,
            prep: 10,
            capacity: 5,
            // Rojo y azul de Copec.
            color: '#d71920',
            color2: '#0b3b8c',
            products: [
              ['Completos', 'Completo italiano', 'Tomate, palta y mayo', 2900, '🌭'],
              ['Completos', 'Completo palta', 'Palta Hass', 2700, '🌭'],
              ['Completos', 'Completo dinámico', 'Tomate, palta, mayo, americana y chucrut', 3200, '🌭'],
              ['Completos', 'As italiano', 'Carne, tomate, palta y mayo en pan de completo', 3900, '🌭'],
              ['Sándwiches', 'Churrasco italiano', 'Carne de vacuno, tomate, palta y mayo', 4700, '🥪'],
              ['Sándwiches', 'Barros luco', 'Carne de vacuno y queso fundido', 4300, '🥪'],
              ['Sándwiches', 'Ave palta', 'Pollo, palta y mayo en pan frica', 3900, '🥪'],
              ['Sándwiches', 'Croissant jamón queso', 'Tibio', 2300, '🥐'],
              ['Para picar', 'Papas fritas', 'Porción mediana', 1900, '🍟'],
              ['Para picar', 'Empanada de pino', 'Al horno', 1800, '🥟'],
              ['Para picar', 'Churros', 'Tres unidades, con azúcar', 1500, '🥖'],
              ['Para picar', 'Medialuna', 'Bollería del día', 900, '🥐'],
              ['Café de grano', 'Café de grano', 'Mediano, 350 ml', 1900, '☕'],
              ['Café de grano', 'Cortado', 'Mediano', 1800, '☕'],
              ['Café de grano', 'Capuccino vainilla', 'Mediano', 2400, '☕'],
              ['Bebidas', 'Bebida en lata', '350 ml', 1200, '🥤'],
              ['Bebidas', 'Bebida energética', '250 ml', 1900, '⚡'],
              ['Bebidas', 'Agua mineral', '500 ml', 1000, '💧'],
            ],
          },
          {
            name: 'Casino',
            email: 'casino@torugo.cl',
            description: 'Almuerzo del día y colaciones',
            emoji: '🍛',
            location: 'Segundo piso',
            opens: 480,
            closes: 1080,
            prep: 15,
            capacity: 10,
            baes: true,
            // Amarillo y negro de Duoc UC: el Casino es de la sede.
            color: '#ffb81c',
            color2: '#1f1f1f',
            products: [
              ['Almuerzos', 'Menú del día', 'Entrada, plato de fondo y postre', 4000, '🍛'],
              ['Almuerzos', 'Menú vegetariano', 'Entrada, plato de fondo y postre', 4000, '🥦'],
              ['Almuerzos', 'Charquicán con huevo', 'Con ensalada chilena', 3600, '🍳'],
              ['Almuerzos', 'Porotos con riendas', 'Con longaniza opcional', 3500, '🫘'],
              ['Almuerzos', 'Pollo asado con arroz', 'Cuarto de pollo y ensalada', 3900, '🍗'],
              ['Almuerzos', 'Lasaña boloñesa', 'Porción individual', 4200, '🍝'],
              ['Colaciones', 'Sándwich de ave mayo', 'En pan de molde', 1900, '🥪'],
              ['Colaciones', 'Yogur con cereal', 'Vaso individual', 1200, '🥣'],
              ['Colaciones', 'Fruta picada', 'Vaso individual', 1000, '🍓'],
              ['Colaciones', 'Kuchen de manzana', 'Trozo', 1400, '🥧'],
              ['Bebidas', 'Jugo en caja', '200 ml', 800, '🧃'],
              ['Bebidas', 'Té o café', '250 ml', 900, '🍵'],
              ['Bebidas', 'Agua mineral', '500 ml', 900, '💧'],
            ],
          },
        ],
      },
      { name: 'Sede Valparaíso', city: 'Valparaíso', shops: [] },
    ],
  },
  {
    institution: 'Universidad de Ejemplo',
    campuses: [
      {
        name: 'Campus Central',
        city: 'Santiago',
        shops: [
          {
            name: 'Cafetería Central',
            email: 'cafeteria@torugo.cl',
            description: 'Café de especialidad y pastelería',
            emoji: '🧁',
            location: 'Biblioteca, primer piso',
            opens: 480,
            closes: 1200,
            prep: 5,
            capacity: 8,
            baes: true,
            color: '#7a1f3d',
            color2: '#f2c14e',
            products: [
              ['Café', 'Espresso', 'Simple', 1500, '☕'],
              ['Café', 'Capuccino', '300 ml', 2400, '☕'],
              ['Café', 'Latte frío', '400 ml', 2800, '🧋'],
              ['Para comer', 'Croissant de jamón y queso', 'Tibio', 2600, '🥐'],
              ['Para comer', 'Brownie', 'Con nueces', 1800, '🍫'],
              ['Para comer', 'Wrap de pollo', 'Con lechuga y salsa de yogur', 3500, '🌯'],
            ],
          },
        ],
      },
    ],
  },
];

// Opciones de ejemplo: un grupo de elección única obligatoria y otro de agregados opcionales.
const group = (id, name, required, multiple, choices) => ({
  id,
  name,
  required,
  multiple,
  choices: choices.map(([n, price], i) => ({ id: `${id}${i + 1}`, name: n, price })),
});
const DEMO_OPTIONS = {
  'Café americano': [group('t', 'Tamaño', true, false, [['Mediano', 0], ['Grande', 400]])],
  Capuccino: [group('t', 'Tamaño', true, false, [['Mediano', 0], ['Grande', 500]])],
  'Bubble tea de leche': [
    group('t', 'Tamaño', true, false, [['Mediano', 0], ['Grande', 600]]),
    group('e', 'Extras', false, true, [['Más perlas', 500], ['Crema de queso', 700]]),
  ],
  'Bubble tea de frutas': [
    group('s', 'Sabor', true, false, [['Maracuyá', 0], ['Frutilla', 0], ['Mango', 0]]),
    group('t', 'Tamaño', true, false, [['Mediano', 0], ['Grande', 600]]),
  ],
  'Latte de vainilla': [group('l', 'Leche', true, false, [['Entera', 0], ['Descremada', 0], ['Vegetal', 400]])],
  'Completo italiano': [group('e', 'Agregados', false, true, [['Doble palta', 600], ['Queso', 500]])],
  'Churrasco italiano': [group('e', 'Agregados', false, true, [['Queso', 500], ['Ají verde', 0], ['Huevo', 400]])],
  'Café de grano': [group('l', 'Leche', false, false, [['Con leche', 200], ['Leche vegetal', 400]])],
};

// Comisión de ejemplo de la plataforma en la demo, en puntos base (800 = 8 %).
const DEMO_COMMISSION_BPS = 800;

const DEMO_STUDENTS = ['Camila Rojas', 'Matías Soto', 'Valentina Díaz', 'Benjamín Fuentes', 'Antonia Vera', 'Tomás Reyes'];

// Generador determinista: el historial de demostración es igual en cada instalación.
function rng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pedidos ya entregados de los últimos días, para que los paneles de métricas tengan algo que mostrar. */
function seedHistory(db, now, shops, studentIds) {
  const rand = rng(20261113);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const today = chileNow(now).date;
  const insOrder = db.prepare(
    `INSERT INTO orders (code, user_id, shop_id, slot, status, payment_method, payment_status, payment_ref, fee, paid, total, note, rating, on_time, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'',?,?,?)`,
  );
  const insItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, emoji, price, qty) VALUES (?,?,?,?,?,?)');
  const insEvent = db.prepare('INSERT INTO order_events (order_id, status, at) VALUES (?,?,?)');
  // Los recreos concentran la demanda: más pedidos a media mañana y al almuerzo.
  const peaks = [600, 610, 620, 780, 790, 800, 810, 820, 830, 840, 960, 970];
  let n = 0;
  for (let back = 7; back >= 1; back--) {
    const date = addDays(today, -back);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday === 0) continue;
    for (const shop of shops) {
      const count = Math.round((weekday === 6 ? 4 : 14) + rand() * 8);
      for (let i = 0; i < count; i++) {
        let minutes = pick(peaks) + (rand() < 0.3 ? Math.round((rand() - 0.5) * 12) * 10 : 0);
        minutes = Math.min(shop.closes, Math.max(shop.opens + shop.prep, Math.round(minutes / 10) * 10));
        const slot = `${date}T${hhmm(minutes)}`;
        const lines = [];
        const kinds = 1 + Math.floor(rand() * 2.2);
        for (let k = 0; k < kinds; k++) {
          const p = pick(shop.products);
          if (!lines.some((l) => l.p.id === p.id)) lines.push({ p, qty: rand() < 0.2 ? 2 : 1 });
        }
        const total = lines.reduce((sum, l) => sum + l.p.price * l.qty, 0);
        const roll = rand();
        const status = roll < 0.92 ? 'entregado' : roll < 0.96 ? 'cancelado' : 'no_retirado';
        const onTime = status === 'cancelado' ? null : rand() < 0.93 ? 1 : 0;
        const rating = status === 'entregado' && rand() < 0.6 ? (rand() < 0.75 ? 5 : rand() < 0.7 ? 4 : 3) : null;
        // En los locales adheridos, cerca de un tercio paga con la beca Junaeb al retirar.
        const baes = shop.baes && status !== 'cancelado' && rand() < 0.35;
        const at = new Date(Date.parse(`${slot}:00-03:00`));
        const iso = (deltaMin) => new Date(at.getTime() + deltaMin * 60000).toISOString();
        const id = insOrder.run(
          `H${String(++n).padStart(5, '0')}`,
          pick(studentIds),
          shop.id,
          slot,
          status,
          baes ? 'junaeb' : 'app',
          // Pagado en la app: los cancelados quedaron reembolsados. Con la beca, se cobró al entregar.
          baes ? (status === 'entregado' ? 'aprobado' : '') : status === 'cancelado' ? 'reembolsado' : 'aprobado',
          baes ? '' : `simulado-${n}`,
          status === 'cancelado' || baes ? 0 : Math.round((total * DEMO_COMMISSION_BPS) / 10000),
          status === 'cancelado' || (baes && status !== 'entregado') ? 0 : 1,
          total,
          rating,
          onTime,
          iso(-25),
        ).lastInsertRowid;
        for (const l of lines) insItem.run(id, l.p.id, l.p.name, l.p.emoji, l.p.price, l.qty);
        insEvent.run(id, 'recibido', iso(-25));
        if (status === 'cancelado') insEvent.run(id, 'cancelado', iso(-20));
        else {
          insEvent.run(id, 'preparando', iso(-12));
          insEvent.run(id, 'listo', iso(onTime ? -3 : 4));
          insEvent.run(id, status, iso(status === 'entregado' ? 2 : 30));
        }
      }
    }
  }
}

export function seedIfEmpty(db, { now = new Date(), history = true } = {}) {
  if (db.prepare('SELECT COUNT(*) AS c FROM institutions').get().c > 0) return false;
  const nowIso = now.toISOString();
  const passHash = hashPassword(DEMO_PASSWORD);
  const insUser = db.prepare(
    `INSERT INTO users (name, email, pass_hash, role, campus_id, shop_id, institution_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  db.exec('BEGIN');
  let firstCampus = null;
  const historyShops = [];
  DATA.forEach((inst, index) => {
    const instId = db.prepare('INSERT INTO institutions (name) VALUES (?)').run(inst.institution).lastInsertRowid;
    insUser.run(
      `Administración ${inst.institution}`,
      index === 0 ? 'admin@torugo.cl' : `admin${index + 1}@torugo.cl`,
      passHash,
      'admin',
      null,
      null,
      instId,
      nowIso,
    );
    for (const campus of inst.campuses) {
      const campusId = db
        .prepare('INSERT INTO campuses (institution_id, name, city, baes_operator) VALUES (?,?,?,?)')
        .run(instId, campus.name, campus.city, operatorForCity(campus.city)).lastInsertRowid;
      firstCampus ??= campusId;
      for (const s of campus.shops) {
        const shopId = db
          .prepare(
            `INSERT INTO shops (campus_id, name, description, emoji, location, opens, closes, days, prep_minutes, slot_capacity, accepts_baes, color, color_2, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'activo',?)`,
          )
          .run(
            campusId,
            s.name,
            s.description,
            s.emoji,
            s.location,
            s.opens,
            s.closes,
            s.days ?? '0123456',
            s.prep,
            s.capacity,
            s.baes ? 1 : 0,
            s.color ?? '',
            s.color2 ?? '',
            nowIso,
          )
          .lastInsertRowid;
        const insProduct = db.prepare(
          'INSERT INTO products (shop_id, category, name, description, price, emoji, options) VALUES (?,?,?,?,?,?,?)',
        );
        const products = s.products.map((p) => ({
          id: insProduct.run(shopId, ...p, JSON.stringify(DEMO_OPTIONS[p[1]] ?? [])).lastInsertRowid,
          name: p[1],
          price: p[3],
          emoji: p[4],
        }));
        if (campusId === firstCampus) historyShops.push({ id: shopId, opens: s.opens, closes: s.closes, prep: s.prep, baes: !!s.baes, products });
        insUser.run(`Equipo ${s.name}`, s.email, passHash, 'shop', campusId, shopId, null, nowIso);
      }
    }
  });
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('commission_bps', ?)").run(String(DEMO_COMMISSION_BPS));
  // En la demo, el Casino también acepta pagar al retirar; los demás solo cobran en la app.
  db.prepare("UPDATE shops SET pay_at_shop = 1 WHERE name = 'Casino'").run();
  // Ejemplos de promociones en horas tranquilas y tarjetas de sellos. Las define y las paga la plataforma, por eso
  // no superan su comisión.
  db.prepare("UPDATE shops SET promos = ?, loyalty_every = 5, loyalty_max = 2500 WHERE name = 'Pepe Pug'").run(
    JSON.stringify([{ from: 660, to: 720, percent: 5 }, { from: 900, to: 990, percent: 8 }]),
  );
  db.prepare("UPDATE shops SET promos = ?, loyalty_every = 6, loyalty_max = 2000 WHERE name = 'Pronto Copec'").run(
    JSON.stringify([{ from: 960, to: 1080, percent: 5 }]),
  );
  db.prepare("UPDATE shops SET loyalty_every = 8, loyalty_max = 4000 WHERE name = 'Casino'").run();
  // El menú del día necesita más tiempo que el resto del Casino.
  db.prepare("UPDATE products SET prep_minutes = 25 WHERE name IN ('Menú del día', 'Menú vegetariano')").run();
  insUser.run(`Equipo ${BRAND}`, 'plataforma@torugo.cl', passHash, 'owner', null, null, null, nowIso);
  const studentIds = [insUser.run('Estudiante Demo', 'estudiante@torugo.cl', passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid];
  // La estudiante de la demo tiene beca Junaeb y sus recreos guardados, para mostrar las dos funciones.
  db.prepare('UPDATE users SET baes = 1, breaks = ? WHERE id = ?').run(
    JSON.stringify([
      { days: '12345', from: 620, to: 640 },
      { days: '12345', from: 790, to: 830 },
      { days: '135', from: 990, to: 1010 },
    ]),
    studentIds[0],
  );
  if (history) {
    DEMO_STUDENTS.forEach((name, i) =>
      studentIds.push(insUser.run(name, `demo${i + 1}@torugo.cl`, passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid),
    );
    seedHistory(db, now, historyShops, studentIds.slice(1));
  }
  db.exec('COMMIT');
  return true;
}
