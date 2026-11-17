import * as webpush from 'web-push';

/**
 * Notificaciones push: llegan aunque la app esté cerrada.
 * Las llaves VAPID se generan una vez y se guardan en la base.
 */
export function createPush(db) {
  let keys;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get();
  if (row) keys = JSON.parse(row.value);
  else {
    keys = webpush.generateVAPIDKeys();
    db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  }
  // Los servicios de push piden un contacto real del operador: defínelo en producción.
  const subject = process.env.GOBITE_VAPID_SUBJECT ?? 'mailto:soporte@example.com';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);

  const deliver = (subs, payload) => {
    const body = JSON.stringify(payload);
    for (const s of subs) {
      webpush
        .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 900,
          urgency: 'high',
        })
        .catch((err) => {
          // 404/410: el navegador dio de baja la suscripción.
          if (err.statusCode === 404 || err.statusCode === 410)
            db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
          else console.warn('No se pudo enviar una notificación push:', err.statusCode ?? err.message);
        });
    }
  };

  return {
    publicKey: keys.publicKey,
    toUser(userId, payload) {
      deliver(db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId), payload);
    },
    toShop(shopId, payload) {
      deliver(
        db
          .prepare(
            `SELECT p.* FROM push_subscriptions p JOIN users u ON u.id = p.user_id
             WHERE u.shop_id = ? AND u.role = 'shop' AND u.deleted_at IS NULL`,
          )
          .all(shopId),
        payload,
      );
    },
  };
}
