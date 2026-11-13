import { hashPassword } from './auth.js';
import { addDays, chileNow, hhmm } from './time.js';

export const DEMO_PASSWORD = 'pickgo123';

// Datos de demostración. Los locales de Duoc UC Viña del Mar salen del informe del proyecto;
// los menús y precios son de ejemplo y cada local los edita desde su panel.
const DATA = [
  {
    institution: 'Duoc UC',
    campuses: [
      {
        name: 'Sede Viña del Mar',
        city: 'Viña del Mar',
        shops: [
          {
            name: 'Pronto Copec',
            email: 'copec@pickgo.cl',
            description: 'Almuerzos, sándwiches y cafetería',
            emoji: '🥪',
            location: 'Acceso principal',
            opens: 450,
            closes: 1320,
            prep: 10,
            capacity: 6,
            products: [
              ['Desayunos', 'Café + medialuna', 'Café de grano 250 ml con medialuna', 2200, '🥐'],
              ['Desayunos', 'Tostadas con palta', 'Pan de molde integral con palta', 2500, '🥑'],
              ['Desayunos', 'Yogurt con granola', 'Yogurt natural, granola y fruta', 1900, '🥣'],
              ['Almuerzos', 'Menú ejecutivo casero', 'Plato de fondo del día, ensalada y pan', 4500, '🍱'],
              ['Almuerzos', 'Sándwich ave mayo', 'Pollo desmenuzado con mayonesa casera', 2500, '🥪'],
              ['Almuerzos', 'Lasaña boloñesa', 'Receta original gratinada', 4800, '🍝'],
              ['Almuerzos', 'Ensalada de quínoa', 'Vegetariana, con verduras de temporada', 3900, '🥗'],
              ['Almuerzos', 'Completo italiano', 'Palta, tomate y mayonesa', 2300, '🌭'],
              ['Bebidas', 'Café americano', '350 ml', 1500, '☕'],
              ['Bebidas', 'Jugo natural', 'Naranja o frambuesa, 400 ml', 1800, '🧃'],
              ['Bebidas', 'Agua mineral', 'Con o sin gas, 500 ml', 1000, '💧'],
              ['Bebidas', 'Bebida en lata', '350 ml', 1200, '🥤'],
            ],
          },
          {
            name: 'Pepepug',
            email: 'pepepug@pickgo.cl',
            description: 'Sándwiches express y papas fritas',
            emoji: '🌭',
            location: 'Patio central',
            opens: 540,
            closes: 1260,
            prep: 10,
            capacity: 5,
            products: [
              ['Sándwiches', 'Churrasco italiano', 'Carne, palta, tomate y mayonesa', 4200, '🥙'],
              ['Sándwiches', 'Barros luco', 'Carne a la plancha y queso fundido', 3900, '🥪'],
              ['Sándwiches', 'Completo italiano', 'El clásico', 2200, '🌭'],
              ['Sándwiches', 'Hamburguesa vegetariana', 'Lentejas, lechuga y tomate', 3800, '🍔'],
              ['Acompañamientos', 'Papas fritas', 'Porción mediana', 2000, '🍟'],
              ['Acompañamientos', 'Empanada de queso', 'Frita, recién hecha', 1500, '🥟'],
              ['Bebidas', 'Bebida en lata', '350 ml', 1200, '🥤'],
              ['Bebidas', 'Agua mineral', '500 ml', 1000, '💧'],
            ],
          },
          {
            name: 'Casino',
            email: 'casino@pickgo.cl',
            description: 'Almuerzo del día y colaciones',
            emoji: '🍛',
            location: 'Segundo piso',
            opens: 480,
            closes: 1080,
            prep: 15,
            capacity: 10,
            products: [
              ['Almuerzos', 'Menú del día', 'Entrada, plato de fondo y postre', 4200, '🍛'],
              ['Almuerzos', 'Menú vegetariano', 'Entrada, plato de fondo y postre', 4200, '🥦'],
              ['Almuerzos', 'Pollo con arroz', 'Con ensalada surtida', 3800, '🍗'],
              ['Colaciones', 'Fruta de estación', 'Porción individual', 900, '🍎'],
              ['Colaciones', 'Queque casero', 'Trozo', 1200, '🍰'],
              ['Bebidas', 'Jugo en caja', '200 ml', 800, '🧃'],
              ['Bebidas', 'Té o café', '250 ml', 1000, '🍵'],
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
            email: 'cafeteria@pickgo.cl',
            description: 'Café de especialidad y pastelería',
            emoji: '☕',
            location: 'Biblioteca, primer piso',
            opens: 480,
            closes: 1200,
            prep: 5,
            capacity: 8,
            products: [
              ['Café', 'Espresso', 'Simple', 1500, '☕'],
              ['Café', 'Capuccino', '300 ml', 2400, '☕'],
              ['Café', 'Latte frío', '400 ml', 2800, '🧋'],
              ['Para comer', 'Croissant de jamón y queso', 'Tibio', 2600, '🥐'],
              ['Para comer', 'Brownie', 'Con nueces', 1800, '🍫'],
              ['Para comer', 'Wrap de pollo', 'Con lechuga y salsa de yogurt', 3500, '🌯'],
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
  'Menú ejecutivo casero': [
    group('b', 'Bebida', true, false, [['Agua', 0], ['Jugo', 0], ['Bebida', 300]]),
    group('e', 'Extras', false, true, [['Pan extra', 300], ['Postre', 700]]),
  ],
  'Churrasco italiano': [group('e', 'Agregados', false, true, [['Queso', 500], ['Tocino', 700], ['Huevo', 400]])],
  'Completo italiano': [group('e', 'Agregados', false, true, [['Queso', 400], ['Chucrut', 200]])],
};

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
    `INSERT INTO orders (code, user_id, shop_id, slot, status, payment_method, paid, total, note, rating, on_time, created_at)
     VALUES (?,?,?,?,?,'local',?,?,'',?,?,?)`,
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
        const at = new Date(Date.parse(`${slot}:00-03:00`));
        const iso = (deltaMin) => new Date(at.getTime() + deltaMin * 60000).toISOString();
        const id = insOrder.run(
          `H${String(++n).padStart(5, '0')}`,
          pick(studentIds),
          shop.id,
          slot,
          status,
          status === 'entregado' ? 1 : 0,
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
      index === 0 ? 'admin@pickgo.cl' : `admin${index + 1}@pickgo.cl`,
      passHash,
      'admin',
      null,
      null,
      instId,
      nowIso,
    );
    for (const campus of inst.campuses) {
      const campusId = db
        .prepare('INSERT INTO campuses (institution_id, name, city) VALUES (?,?,?)')
        .run(instId, campus.name, campus.city).lastInsertRowid;
      firstCampus ??= campusId;
      for (const s of campus.shops) {
        const shopId = db
          .prepare(
            `INSERT INTO shops (campus_id, name, description, emoji, location, opens, closes, prep_minutes, slot_capacity, status, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,'activo',?)`,
          )
          .run(campusId, s.name, s.description, s.emoji, s.location, s.opens, s.closes, s.prep, s.capacity, nowIso)
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
        if (campusId === firstCampus) historyShops.push({ id: shopId, opens: s.opens, closes: s.closes, prep: s.prep, products });
        insUser.run(`Equipo ${s.name}`, s.email, passHash, 'shop', campusId, shopId, null, nowIso);
      }
    }
  });
  insUser.run('Equipo Pick&Go', 'plataforma@pickgo.cl', passHash, 'owner', null, null, null, nowIso);
  const studentIds = [insUser.run('Estudiante Demo', 'estudiante@pickgo.cl', passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid];
  if (history) {
    DEMO_STUDENTS.forEach((name, i) =>
      studentIds.push(insUser.run(name, `demo${i + 1}@pickgo.cl`, passHash, 'student', firstCampus, null, null, nowIso).lastInsertRowid),
    );
    seedHistory(db, now, historyShops, studentIds.slice(1));
  }
  db.exec('COMMIT');
  return true;
}
