/**
 * Beca de Alimentación para la Educación Superior (BAES) de Junaeb.
 *
 * La beca no se puede cobrar dentro de la app: no existe una integración pública para plataformas. Se paga en el
 * mesón del local al retirar, con la tarjeta o la app del operador. Lo que la app sí hace es dejar todo listo para
 * que ese cobro tome segundos: el monto fijo, el pedido preparado y las instrucciones del operador que corresponde.
 *
 * El operador depende de la región: Pluxee en la Región Metropolitana y Edenred en el resto del país (2026).
 * Como Junaeb lo licita y puede cambiar, se guarda por sede y la institución lo puede corregir.
 */

export const OPERATORS = ['edenred', 'pluxee'];

const plain = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Comunas de la Región Metropolitana.
const RM = new Set(
  [
    'Santiago', 'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central', 'Huechuraba', 'Independencia',
    'La Cisterna', 'La Florida', 'La Granja', 'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo',
    'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén', 'Providencia', 'Pudahuel', 'Quilicura',
    'Quinta Normal', 'Recoleta', 'Renca', 'San Joaquín', 'San Miguel', 'San Ramón', 'Vitacura', 'Puente Alto', 'Pirque',
    'San José de Maipo', 'Colina', 'Lampa', 'Tiltil', 'San Bernardo', 'Buin', 'Calera de Tango', 'Paine', 'Melipilla',
    'Alhué', 'Curacaví', 'María Pinto', 'San Pedro', 'Talagante', 'El Monte', 'Isla de Maipo', 'Padre Hurtado',
    'Peñaflor',
  ].map(plain),
);

/** Operador que corresponde a una ciudad o comuna, como punto de partida. */
export const operatorForCity = (city) => (RM.has(plain(city)) ? 'pluxee' : 'edenred');
