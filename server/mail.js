import nodemailer from 'nodemailer';

/**
 * Envío de correos por SMTP (sirve con cualquier proveedor). Se activa solo si están definidas:
 *   PICKGO_SMTP_URL    por ejemplo smtps://usuario:clave@smtp.proveedor.com
 *   PICKGO_MAIL_FROM   por ejemplo "Pick&Go <no-responder@tudominio.cl>"
 *   PICKGO_PUBLIC_URL  la dirección pública de la app, para armar los enlaces de los correos
 * Sin ellas devuelve null y la app funciona igual, sin las funciones que dependen del correo.
 */
export function createMailer(env = process.env) {
  const { PICKGO_SMTP_URL: smtp, PICKGO_MAIL_FROM: from, PICKGO_PUBLIC_URL: publicUrl } = env;
  if (!smtp || !from || !publicUrl) return null;
  let base;
  try {
    base = new URL(publicUrl);
  } catch {
    console.warn('PICKGO_PUBLIC_URL no es una dirección válida: el correo queda desactivado.');
    return null;
  }
  const transport = nodemailer.createTransport(smtp);
  return {
    // Los enlaces siempre usan la dirección configurada, nunca la que venga en la solicitud.
    link: (path) => new URL(path, base).href,
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}
