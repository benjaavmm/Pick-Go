import { hashPassword } from './auth.js';

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

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS c FROM institutions').get().c > 0) return false;
  const nowIso = new Date().toISOString();
  const passHash = hashPassword(DEMO_PASSWORD);
  const insUser = db.prepare(
    'INSERT INTO users (name, email, pass_hash, role, campus_id, shop_id, created_at) VALUES (?,?,?,?,?,?,?)',
  );
  db.exec('BEGIN');
  let firstCampus = null;
  for (const inst of DATA) {
    const instId = db.prepare('INSERT INTO institutions (name) VALUES (?)').run(inst.institution).lastInsertRowid;
    for (const campus of inst.campuses) {
      const campusId = db
        .prepare('INSERT INTO campuses (institution_id, name, city) VALUES (?,?,?)')
        .run(instId, campus.name, campus.city).lastInsertRowid;
      firstCampus ??= campusId;
      for (const s of campus.shops) {
        const shopId = db
          .prepare(
            `INSERT INTO shops (campus_id, name, description, emoji, location, opens, closes, prep_minutes, slot_capacity)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(campusId, s.name, s.description, s.emoji, s.location, s.opens, s.closes, s.prep, s.capacity)
          .lastInsertRowid;
        const insProduct = db.prepare(
          'INSERT INTO products (shop_id, category, name, description, price, emoji) VALUES (?,?,?,?,?,?)',
        );
        for (const p of s.products) insProduct.run(shopId, ...p);
        insUser.run(`Equipo ${s.name}`, s.email, passHash, 'shop', campusId, shopId, nowIso);
      }
    }
  }
  insUser.run('Estudiante Demo', 'estudiante@pickgo.cl', passHash, 'student', firstCampus, null, nowIso);
  db.exec('COMMIT');
  return true;
}
