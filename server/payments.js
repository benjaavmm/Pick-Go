/**
 * Cobro en la app. Dos modos, elegidos con PICKGO_PAYMENTS:
 *
 *  - 'simulado'    Marcha blanca: el flujo completo funciona, pero el "pago" se aprueba o rechaza en una pantalla
 *                  de prueba de la propia app. No se mueve dinero.
 *  - 'mercadopago' Cobro real con Mercado Pago Checkout Pro (API de Orders). Requiere PICKGO_MP_ACCESS_TOKEN y
 *                  PICKGO_PUBLIC_URL.
 *                  Con las credenciales de prueba de Mercado Pago se paga con tarjetas de prueba.
 *
 * Sin PICKGO_PAYMENTS no hay cobro en la app y todos los pedidos se pagan en el local.
 *
 * El dinero entra a la cuenta de quien opera la plataforma; la app calcula la comisión de cada pedido y lo que hay
 * que transferir a cada local (ver "Pagos" en el panel de la plataforma).
 */
import crypto from 'node:crypto';

export const CHECKOUT_MINUTES = 15;

export function createPayments(env = process.env, { apiBase = 'https://api.mercadopago.com', fetchImpl = fetch } = {}) {
  const mode = env.PICKGO_PAYMENTS;
  if (!mode) return null;
  if (mode === 'simulado') return simulated();
  if (mode !== 'mercadopago') throw new Error(`PICKGO_PAYMENTS no reconoce "${mode}": usa simulado o mercadopago.`);
  const token = env.PICKGO_MP_ACCESS_TOKEN;
  let publicUrl;
  try {
    publicUrl = new URL(env.PICKGO_PUBLIC_URL ?? '');
  } catch {
    publicUrl = null;
  }
  if (!token || !publicUrl) throw new Error('Para cobrar con Mercado Pago define PICKGO_MP_ACCESS_TOKEN y PICKGO_PUBLIC_URL.');
  return mercadoPago({ token, publicUrl, apiBase, fetchImpl, webhookSecret: env.PICKGO_MP_WEBHOOK_SECRET });
}

function simulated() {
  return {
    mode: 'simulado',
    async createCheckout(order) {
      return { url: `/pago-de-prueba/${order.id}`, ref: `simulado-${order.id}` };
    },
    // En el modo simulado el resultado lo informa la pantalla de prueba; no hay nada que consultar afuera.
    async findPayment() {
      return null;
    },
    async getPayment() {
      return null;
    },
    async cancel() {},
    async refund(ref) {
      return { ok: true, ref: `simulado-${ref}` };
    },
    verifyWebhook() {
      return false;
    },
  };
}

/**
 * Mercado Pago Checkout Pro con la API de Orders (/v1/orders).
 * Cada pedido de Pick&Go crea una "order" de Mercado Pago, cuyo id se guarda en payment_ref.
 */
function mercadoPago({ token, publicUrl, apiBase, fetchImpl, webhookSecret }) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.errors?.map((e) => e.message + (e.details ? ` (${e.details.join(', ')})` : '')).join('; ') ?? data?.message;
      const err = new Error(`Mercado Pago respondió ${res.status}: ${detail ?? 'sin detalle'}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
  const link = (path) => new URL(path, publicUrl).href;
  const validRef = (ref) => /^[A-Za-z0-9]{1,64}$/.test(String(ref ?? ''));
  /** Traduce una order de Mercado Pago al formato que usa la app. */
  const toPayment = (o) =>
    o && {
      ref: String(o.id),
      // processed + accredited = pago aprobado y acreditado.
      status: o.status === 'processed' && o.status_detail === 'accredited' ? 'approved' : o.status,
      amount: Number(o.total_paid_amount && Number(o.total_paid_amount) > 0 ? o.total_paid_amount : o.total_amount),
      currency: o.currency,
      checkoutUrl: o.checkout_url,
    };
  const getOrder = async (ref) => (validRef(ref) ? toPayment(await call('GET', `/v1/orders/${ref}`)) : null);

  return {
    mode: 'mercadopago',
    async createCheckout(order) {
      // Si ya hay una order sin pagar para este pedido, se reutiliza: así nunca hay dos cobros abiertos.
      if (validRef(order.payment_ref)) {
        const prev = await getOrder(order.payment_ref).catch(() => null);
        if (prev?.status === 'created' && prev.checkoutUrl) return { url: prev.checkoutUrl, ref: prev.ref };
      }
      const back = link(`/pedidos/${order.id}?pago=1`);
      const created = await call(
        'POST',
        '/v1/orders',
        {
          type: 'online',
          processing_mode: 'manual',
          // Referencia legible en el panel de Mercado Pago. La app identifica cada cobro por el id de la order.
          external_reference: `${order.code}-${order.id}`,
          total_amount: String(order.total),
          description: `Pedido ${order.code} · ${order.shop_name}`,
          // El enlace de pago vence junto con la reserva de la hora de retiro.
          expiration_time: `PT${CHECKOUT_MINUTES}M`,
          items: [{ title: `Pedido ${order.code} · ${order.shop_name}`, unit_price: String(order.total), quantity: 1, external_code: order.code }],
          config: {
            statement_descriptor: 'PICKGO',
            payment_method: { max_installments: 1 },
            online: { success_url: back, failure_url: back, pending_url: back, auto_return: 'approved' },
          },
        },
        { 'X-Idempotency-Key': `pickgo-${order.id}-${order.code}-${Date.now()}` },
      );
      if (!created?.checkout_url) throw new Error('Mercado Pago no devolvió el enlace de pago.');
      return { url: created.checkout_url, ref: String(created.id) };
    },
    async findPayment(order) {
      return getOrder(order.payment_ref);
    },
    async getPayment(ref) {
      return getOrder(ref);
    },
    /** Cancela una order sin pagar, para que el enlace ya no sirva. */
    async cancel(ref) {
      if (validRef(ref)) await call('POST', `/v1/orders/${ref}/cancel`, undefined, { 'X-Idempotency-Key': `cancel-${ref}` });
    },
    async refund(ref) {
      const r = await call('POST', `/v1/orders/${ref}/refund`, undefined, { 'X-Idempotency-Key': `refund-${ref}` });
      return { ok: true, ref: String(r?.id ?? ref) };
    },
    /**
     * Verifica la firma de una notificación (cabecera x-signature) si se configuró PICKGO_MP_WEBHOOK_SECRET.
     * Aunque la firma falte o no se configure, la app nunca confía en el contenido de la notificación:
     * siempre vuelve a consultar la order a Mercado Pago antes de darla por pagada.
     */
    verifyWebhook(headers, dataId) {
      if (!webhookSecret) return true;
      const sig = String(headers['x-signature'] ?? '');
      const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=')));
      if (!parts.ts || !parts.v1) return false;
      const manifest = `id:${String(dataId).toLowerCase()};request-id:${headers['x-request-id'] ?? ''};ts:${parts.ts};`;
      const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
      return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
    },
  };
}
