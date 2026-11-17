/**
 * Cobro en la app. Dos modos, elegidos con PICKGO_PAYMENTS:
 *
 *  - 'simulado'    Marcha blanca: el flujo completo funciona, pero el "pago" se aprueba o rechaza en una pantalla
 *                  de prueba de la propia app. No se mueve dinero.
 *  - 'mercadopago' Cobro real con Mercado Pago Checkout Pro. Requiere PICKGO_MP_ACCESS_TOKEN y PICKGO_PUBLIC_URL.
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
      return { url: `/pago-de-prueba/${order.id}` };
    },
    // En el modo simulado el resultado lo informa la pantalla de prueba; no hay nada que consultar afuera.
    async findPayment() {
      return null;
    },
    async getPayment() {
      return null;
    },
    async refund(ref) {
      return { ok: true, ref: `simulado-${ref}` };
    },
    verifyWebhook() {
      return false;
    },
  };
}

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
      const err = new Error(`Mercado Pago respondió ${res.status}: ${data?.message ?? 'sin detalle'}`);
      err.status = res.status;
      throw err;
    }
    return data;
  };
  const link = (path) => new URL(path, publicUrl).href;
  const toPayment = (p) =>
    p && {
      ref: String(p.id),
      status: p.status, // approved | pending | in_process | rejected | cancelled | refunded | charged_back
      amount: Number(p.transaction_amount),
      currency: p.currency_id,
      orderId: Number(p.external_reference),
    };

  return {
    mode: 'mercadopago',
    async createCheckout(order) {
      const pref = await call(
        'POST',
        '/checkout/preferences',
        {
          items: [
            {
              id: order.code,
              title: `Pedido ${order.code} · ${order.shop_name}`,
              quantity: 1,
              currency_id: 'CLP',
              unit_price: order.total,
            },
          ],
          external_reference: String(order.id),
          back_urls: {
            success: link(`/pedidos/${order.id}?pago=1`),
            pending: link(`/pedidos/${order.id}?pago=1`),
            failure: link(`/pedidos/${order.id}?pago=1`),
          },
          auto_return: 'approved',
          notification_url: link('/api/payments/webhook'),
          statement_descriptor: 'PICKGO',
          // El enlace de pago vence junto con la reserva de la hora de retiro.
          expires: true,
          expiration_date_to: new Date(Date.now() + CHECKOUT_MINUTES * 60000).toISOString(),
          payment_methods: { installments: 1 },
        },
        // Evita crear dos preferencias si el mismo pedido se reintenta.
        { 'X-Idempotency-Key': `pref-${order.id}-${order.code}-${Math.floor(Date.now() / 60000)}` },
      );
      return { url: pref.init_point };
    },
    async findPayment(orderId) {
      const r = await call('GET', `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc`);
      const list = (r?.results ?? []).map(toPayment);
      return list.find((p) => p.status === 'approved') ?? list[0] ?? null;
    },
    async getPayment(ref) {
      if (!/^\d{1,20}$/.test(String(ref))) return null;
      return toPayment(await call('GET', `/v1/payments/${ref}`));
    },
    async refund(ref) {
      const r = await call('POST', `/v1/payments/${ref}/refunds`, {}, { 'X-Idempotency-Key': `refund-${ref}` });
      return { ok: true, ref: String(r?.id ?? '') };
    },
    /**
     * Verifica la firma de una notificación (cabecera x-signature) si se configuró PICKGO_MP_WEBHOOK_SECRET.
     * Aunque la firma falte o no se configure, la app nunca confía en el contenido de la notificación:
     * siempre vuelve a consultar el pago a Mercado Pago antes de darlo por aprobado.
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
