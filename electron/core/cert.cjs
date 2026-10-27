// Self-signed TLS certificate for the phone pages. Phone browsers only allow
// the camera on secure (https) pages; on the local network there is no public
// certificate, so MESORA makes its own (ECDSA P-256, SHA-256). The phone shows
// a warning once ("connection not private") because nobody vouches for it.
// Valid 397 days: iPhones refuse server certificates valid for longer than 825.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// --- Minimal DER (ASN.1) encoding, enough for an X.509 v3 certificate.
const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const bitString = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octets = (buf) => tlv(0x04, buf);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const explicit = (n, body) => tlv(0xa0 + n, body);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));

function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const bytes = [];
    let v = p;
    do { bytes.unshift(v & 0x7f); v >>= 7; } while (v > 0);
    for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
    out.push(...bytes);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(d) {
  // UTCTime up to 2049, GeneralizedTime after (RFC 5280).
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

const OID = {
  ecdsaSha256: '1.2.840.10045.4.3.2',
  commonName: '2.5.4.3',
  organization: '2.5.4.10',
  subjectAltName: '2.5.29.17',
  basicConstraints: '2.5.29.19',
  keyUsage: '2.5.29.15',
  extKeyUsage: '2.5.29.37',
  serverAuth: '1.3.6.1.5.5.7.3.1',
};

function altNames(hosts) {
  const names = hosts.map((h) => {
    if (net.isIPv4(h)) return tlv(0x87, Buffer.from(h.split('.').map(Number)));
    return tlv(0x82, Buffer.from(h, 'ascii'));
  });
  return seq(...names);
}

/**
 * Makes a new self-signed certificate for these host names and IP addresses.
 * @returns {{ key: string, cert: string }} PEM strings for https.createServer
 */
function selfSignedCert({ hosts = ['localhost', '127.0.0.1'], days = 397, name = 'MESORA Studio (este ordenador)' } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const algorithm = seq(oid(OID.ecdsaSha256));
  const subject = seq(
    set(seq(oid(OID.organization), utf8('MESORA Studio'))),
    set(seq(oid(OID.commonName), utf8(name))),
  );
  const now = Date.now();
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const extensions = seq(
    seq(oid(OID.basicConstraints), bool(true), octets(seq())),
    seq(oid(OID.keyUsage), bool(true), octets(tlv(0x03, Buffer.from([0x07, 0x80])))), // digitalSignature
    seq(oid(OID.extKeyUsage), octets(seq(oid(OID.serverAuth)))),
    seq(oid(OID.subjectAltName), octets(altNames(hosts))),
  );
  const tbs = seq(
    explicit(0, int(Buffer.from([2]))), // v3
    int(serial),
    algorithm,
    subject, // issuer = subject: self-signed
    seq(time(new Date(now - 24 * 3600e3)), time(new Date(now + days * 24 * 3600e3))),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, extensions),
  );
  const signature = crypto.sign('sha256', tbs, privateKey); // DER-encoded ECDSA signature
  const der = seq(tbs, algorithm, bitString(signature));
  const pem = (label, buf) => `-----BEGIN ${label}-----\n${buf.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: pem('CERTIFICATE', der),
  };
}

/**
 * The phone camera's certificate and access code, kept between sessions (in the
 * app's data folder) so a phone accepts the warning once and reconnects by
 * itself after MESORA restarts. Renewed a month before it expires.
 */
function loadIdentity(dir, hosts) {
  const file = path.join(dir, 'phone-camera.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const x509 = new crypto.X509Certificate(saved.cert);
    const fresh = Date.parse(x509.validTo) - Date.now() > 30 * 24 * 3600e3;
    if (fresh && /^[0-9a-f]{32}$/.test(saved.token) && crypto.createPrivateKey(saved.key)) return saved;
  } catch { /* missing or damaged: make a new one */ }
  const made = { ...selfSignedCert({ hosts }), token: crypto.randomBytes(16).toString('hex') };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(made), { mode: 0o600 });
  return made;
}

module.exports = { selfSignedCert, loadIdentity };
