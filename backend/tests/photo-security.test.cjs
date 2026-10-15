require('./security-env.cjs');
require('ts-node/register');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const express = require('express');
const jwt = require('jsonwebtoken');
const prisma = require('../src/config/prisma').default;
const { normalizeProfilePhoto, MAX_PHOTO_BYTES } = require('../src/services/profilePhoto');
const uri = (format, bytes) => `data:image/${format};base64,${bytes.toString('base64')}`;
let png, jpeg, webp;
before(async () => {
  const image = () => sharp({ create: { width: 8, height: 6, channels: 4, background: '#f08020' } });
  png = await image().png().toBuffer(); jpeg = await image().jpeg().toBuffer(); webp = await image().webp().toBuffer();
});

for (const format of ['png', 'jpeg', 'jpg', 'webp']) {
  test(`decodifica y conserva una fotografía ${format} válida`, async () => {
    const result = await normalizeProfilePhoto(uri(format, format === 'png' ? png : format === 'webp' ? webp : jpeg));
    assert.ok(result.startsWith(`data:image/${format === 'jpg' ? 'jpeg' : format};base64,`));
    const metadata = await sharp(Buffer.from(result.split(',')[1], 'base64')).metadata();
    assert.equal(metadata.width, 8); assert.equal(metadata.height, 6);
  });
}

test('rechaza etiquetas inyectadas, SVG/HTML, esquemas activos y base64 no canónico', async () => {
  for (const input of [
    null, {}, '', 'javascript:alert(1)', 'https://example.com/photo.png',
    'data:image/png;base64,AA==\" onerror=alert(1)',
    uri('svg+xml', Buffer.from('<svg onload="alert(1)"/>')),
    uri('png', Buffer.from('<script>alert(1)</script>')),
    'data:image/png;base64,%%%%', uri('png', png).replace(/=+$/, '') + '\n',
    uri('png', png) + '<img src=x onerror=alert(1)>',
  ]) await assert.rejects(normalizeProfilePhoto(input), error => error.status === 400);
});

test('comprueba MIME real, integridad, fin de archivo y decodificación completa', async () => {
  const corrupt = Buffer.from(png); corrupt[45] ^= 255;
  for (const input of [uri('png', jpeg), uri('jpeg', webp), uri('png', png.subarray(0, 30)),
    uri('png', corrupt), uri('jpeg', Buffer.concat([jpeg.subarray(0, 15), Buffer.from([255, 217])])),
    uri('png', Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]))]) {
    await assert.rejects(normalizeProfilePhoto(input), error => error.status === 400);
  }
});

test('limita bytes, dimensiones y píxeles descomprimidos', async () => {
  await assert.rejects(normalizeProfilePhoto(uri('png', Buffer.alloc(MAX_PHOTO_BYTES + 1))), error => error.status === 413);
  const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeProfilePhoto(uri('png', wide)), error => error.status === 413);
  const large = await sharp({ create: { width: 4097, height: 4097, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeProfilePhoto(uri('png', large)), error => error.status === 400);
});

test('quita metadatos y conserva orientación al normalizar', async () => {
  const input = await sharp(jpeg).withExif({ IFD0: { Copyright: '<script>injected</script>' } }).withMetadata({ orientation: 6 }).toBuffer();
  const result = await normalizeProfilePhoto(uri('jpeg', input));
  const output = Buffer.from(result.split(',')[1], 'base64');
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.exif, undefined); assert.equal(metadata.width, 6); assert.equal(metadata.height, 8);
  assert.equal(output.includes(Buffer.from('injected')), false);
});

test('API: rechaza sin escribir, conserva foto anterior y actualiza solo al propietario', async () => {
  const original = { find: prisma.user.findUnique, update: prisma.user.update, profiles: prisma.barberProfile.updateMany, transaction: prisma.$transaction };
  let saved = uri('png', png), profileSaved = saved, writes = 0, owner;
  prisma.user.findUnique = async ({ where }) => ({ id: where.id, rol: where.id === 1 ? 'barbero' : where.id === 2 ? 'cliente' : 'admin', aprobado: true });
  prisma.$transaction = async action => action(prisma);
  prisma.user.update = async ({ where, data }) => { writes++; owner = where.id; saved = data.foto_perfil; return { id: where.id, foto_perfil: saved }; };
  prisma.barberProfile.updateMany = async ({ where, data }) => { assert.equal(where.usuarioId, 1); profileSaved = data.foto_perfil; return { count: 1 }; };
  const app = express(); app.use(express.json({ limit: '6mb' })); app.use('/auth', require('../src/routes/auth').default);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  const send = async (id, photo) => fetch(`http://127.0.0.1:${server.address().port}/auth/me/photo`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: 'Bearer ' + jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1h' }) } : {}) },
    body: JSON.stringify({ foto_perfil: photo, usuarioId: 999 }),
  });
  try {
    assert.equal((await send(null, uri('png', png))).status, 401);
    assert.equal((await send(3, uri('png', png))).status, 403);
    assert.equal((await send(1, 'data:image/png;base64,AAAA')).status, 400);
    assert.equal(saved, uri('png', png)); assert.equal(writes, 0);
    const accepted = await send(1, uri('jpeg', jpeg)); assert.equal(accepted.status, 200);
    assert.equal(owner, 1); assert.equal(saved, (await accepted.json()).foto_perfil); assert.equal(saved, profileSaved);
    const beforeInvalid = saved;
    assert.equal((await send(1, uri('png', Buffer.from('<svg/>')))).status, 400);
    assert.equal(saved, beforeInvalid); assert.equal(writes, 1);
    assert.equal((await send(2, uri('webp', webp))).status, 200); assert.equal(owner, 2); assert.equal(profileSaved, beforeInvalid);
  } finally {
    prisma.user.findUnique = original.find; prisma.user.update = original.update;
    prisma.barberProfile.updateMany = original.profiles; prisma.$transaction = original.transaction;
    await new Promise(resolve => server.close(resolve));
  }
});
after(() => prisma.$disconnect());
