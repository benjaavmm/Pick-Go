import { hashPassword } from './auth.js';
import { operatorForCity } from './baes.js';
import { BRAND } from './brand.js';
import { addDays, chileNow, hhmm } from './time.js';

export const DEMO_PASSWORD = 'altiro123';

// Datos de demostración. Los locales, menús y precios son inventados: cada local real edita los suyos desde su panel.
const DATA = [
  {
    institution: 'Duoc UC',
    campuses: [
      {
        name: 'Sede Viña del Mar',
        city: 'Viña del Mar',
        shops: [
          {
            name: 'Café Andén',
            email: 'cafe@altiro.cl',
            description: 'Cafetería, almuerzos caseros y para llevar',
            emoji: '☕',
            location: 'Acceso principal',
            opens: 450,
            closes: 1320,
            prep: 10,
            capacity: 6,
            baes: true,
            products: [
              ['Desayunos', 'Café con queque', 'Café de filtro 250 ml y queque de naranja', 2100, '☕'],
              ['Desayunos', 'Pan amasado con palta', 'Recién horneado', 2300, '🥑'],
              ['Desayunos', 'Bowl de yogur', 'Yogur griego, avena tostada y plátano', 2400, '🥣'],
              ['Almuerzos', 'Plato del día', 'Fondo casero con acompañamiento y ensalada', 4300, '🍲'],
              ['Almuerzos', 'Wrap de pollo al pesto', 'Tortilla integral, pollo, tomate y pesto', 3400, '🌯'],
              ['Almuerzos', 'Pastel de choclo', 'Porción individual', 4600, '🌽'],
              ['Almuerzos', 'Ensalada César', 'Lechuga, pollo grillé, crutones y parmesano', 3700, '🥗'],
              ['Almuerzos', 'Barros jarpa', 'Jamón y queso fundido en pan frica', 2600, '🥪'],
              ['Bebidas', 'Café americano', '350 ml', 1500, '☕'],
              ['Bebidas', 'Té con leche', '300 ml', 1300, '🍵'],
              ['Bebidas', 'Jugo natural', 'Naranja o piña, 400 ml', 1900, '🧃'],
              ['Bebidas', 'Agua mineral', 'Con o sin gas, 500 ml', 1000, '💧'],
            ],
          },
          {
            name: 'La Sanguchería',
            email: 'sangucheria@altiro.cl',
            description: 'Sándwiches chilenos y para picar',
            emoji: '🥪',
            location: 'Patio central',
            opens: 540,
            closes: 1260,
            prep: 10,
            capacity: 5,
            products: [
              ['Sándwiches', 'Chacarero', 'Carne, porotos verdes, tomate y ají verde', 4300, '🥙'],
              ['Sándwiches', 'Lomito italiano', 'Lomo de cerdo, palta, tomate y mayo', 4100, '🥪'],
              ['Sándwiches', 'As luco', 'Carne y queso fundido', 3600, '🥪'],
              ['Sándwiches', 'Burger de garbanzos', 'Lechuga, tomate y salsa de yogur', 3700, '🍔'],
              ['Para picar', 'Papas fritas', 'Porción mediana', 1900, '🍟'],
              ['Para picar', 'Empanada de pino', 'Al horno', 1800, '🥟'],
              ['Para picar', 'Sopaipillas', 'Tres unidades, con pebre', 1200, '🫓'],
              ['Bebidas', 'Bebida en lata', '350 ml', 1200, '🥤'],
              ['Bebidas', 'Agua mineral', '500 ml', 1000, '💧'],
            ],
          },
          {
            name: 'Casino',
            email: 'casino@altiro.cl',
            description: 'Almuerzo del día y colaciones',
            emoji: '🍛',
            location: 'Segundo piso',
            opens: 480,
            closes: 1080,
            prep: 15,
            capacity: 10,
            baes: true,
            products: [
              ['Almuerzos', 'Menú del día', 'Entrada, plato de fondo y postre', 4000, '🍛'],
              ['Almuerzos', 'Menú vegetariano', 'Entrada, plato de fondo y postre', 4000, '🥦'],
              ['Almuerzos', 'Charquicán con huevo', 'Con ensalada chilena', 3600, '🍳'],
              ['Almuerzos', 'Porotos con riendas', 'Con longaniza opcional', 3500, '🫘'],
              ['Colaciones', 'Fruta picada', 'Vaso individual', 1000, '🍓'],
              ['Colaciones', 'Kuchen de manzana', 'Trozo', 1400, '🥧'],
              ['Bebidas', 'Jugo en caja', '200 ml', 800, '🧃'],
              ['Bebidas', 'Té o café', '250 ml', 900, '🍵'],
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
            email: 'cafeteria@altiro.cl',
            description: 'Café de especialidad y pastelería',
            emoji: '🧁',
            location: 'Biblioteca, primer piso',
            opens: 480,
            closes: 1200,
            prep: 5,
            capacity: 8,
            baes: true,
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
  'Plato del día': [
    group('a', 'Acompañamiento', true, false, [['Arroz', 0], ['Puré', 0], ['Ensalada extra', 400]]),
    group('e', 'Extras', false, true, [['Pan amasado', 300], ['Postre', 700]]),
  ],
  Chacarero: [group('e', 'Agregados', false, true, [['Queso', 500], ['Palta', 700], ['Huevo', 400]])],
  'Lomito italiano': [group('e', 'Agregados', false, true, [['Queso', 500], ['Ají verde', 0]])],
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
      index === 0 ? 'admin@altiro.cl' : `admin${index + 1}@altiro.cl`,
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
            `INSERT INTO shops (campus_id, name, description, emoji, location, opens, closes, prep_minutes, slot_capacity, accepts_baes, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,'activo',?)`,
          )
          .run(campusId, s.name, s.description, s.emoji, s.location, s.opens, s.closes, s.prep, s.capacity, s.baes ? 1 : 0, nowIso)
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
  // Ejemplos de promociones en horas tranquilas y tarjetas de sellos.
  db.prepare("UPDATE shops SET promos = ?, loyalty_every = 5, loyalty_max = 2500 WHERE name = 'Café Andén'").run(
    JSON.stringify([{ from: 660, to: 720, percent: 10 }, { from: 900, to: 990, percent: 15 }]),
  );
  db.prepare("UPDATE shops SET promos = ?, loyalty_every = 6, loyalty_max = 2000 WHERE name = 'La Sanguchería'").run(
    JSON.stringify([{ from: 960, to: 1080, percent: 10 }]),
  );
  // El menú del día necesita más tiempo que el resto del Casino.
  db.prepare("UPDATE products SET prep_minutes = 25 WHERE name IN ('Menú del día', 'Menú vegetariano')").run();
  insUser.run(`Equipo ${BRAND}`, 'plataforma@altiro.cl', passHash, 'owner', null, null, null, nowIso);
  const studentIds = [insUser.run('Estudiante Demo', 'estudiante@altiro.cl', passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid];
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
      studentIds.push(insUser.run(name, `demo${i + 1}@altiro.cl`, passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid),
    );
    seedHistory(db, now, historyShops, studentIds.slice(1));
  }
  db.exec('COMMIT');
  return true;
}
