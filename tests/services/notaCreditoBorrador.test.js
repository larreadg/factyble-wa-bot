const test = require('node:test');
const assert = require('node:assert/strict');
const {
  borradorVacio,
  construirBorrador,
  sanitizarBorradorParaIA,
  sonEquivalentes,
} = require('../../src/services/notaCreditoBorrador.service');

const CDC = '01800695921001001000000012024071410238123456';
const OTRO_CDC = '01800695921001001000000012024071410238999999';

test('borradorVacio: sin cdc, sin ítems, totalAcreditar en 0', () => {
  const borrador = borradorVacio();
  assert.equal(borrador.cdc, null);
  assert.equal(borrador.items.length, 0);
  assert.equal(borrador.totales.totalAcreditar, 0);
});

test('sin cdc ni items: camposFaltantes pide ambos', () => {
  const borrador = construirBorrador({ cdcExtraido: null, cdcInvalidoExtraido: false, itemsIA: [] }, null);
  assert.equal(borrador.cdc, null);
  assert.ok(borrador.camposFaltantes.some((c) => c.includes('CDC de la factura original')));
  assert.ok(borrador.camposFaltantes.some((c) => c.includes('Al menos un ítem')));
});

test('candidato de cdc con largo inválido: camposFaltantes explica el motivo, no se acepta como cdc', () => {
  const borrador = construirBorrador({ cdcExtraido: null, cdcInvalidoExtraido: true, itemsIA: [] }, null);
  assert.equal(borrador.cdc, null);
  assert.equal(borrador.cdcInvalido, true);
  assert.ok(borrador.camposFaltantes.some((c) => c.includes('no tiene 44 dígitos')));
});

test('cdc válido extraído completa el dato y no aparece en camposFaltantes', () => {
  const borrador = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [] }, null);
  assert.equal(borrador.cdc, CDC);
  assert.equal(borrador.cdcInvalido, false);
  assert.ok(!borrador.camposFaltantes.some((c) => c.includes('CDC')));
});

test('ítems completos: calcula subtotal por ítem y totalAcreditar', () => {
  const borrador = construirBorrador(
    {
      cdcExtraido: CDC,
      cdcInvalidoExtraido: false,
      itemsIA: [
        { descripcion: 'silla', cantidad: 2, precioUnitario: 50000, tasa: '10%' },
        { descripcion: 'mesa', cantidad: 1, precioUnitario: 300000, tasa: '10%' },
      ],
    },
    null,
  );

  assert.equal(borrador.camposFaltantes.length, 0);
  assert.equal(borrador.items[0].descripcion, 'Silla');
  assert.equal(borrador.items[0].subtotal, 100000);
  assert.equal(borrador.totales.totalAcreditar, 400000);
});

test('ítem sin cantidad o precio: camposFaltantes lo lista por nombre', () => {
  const borrador = construirBorrador(
    { cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 2, precioUnitario: null, tasa: '10%' }] },
    null,
  );

  assert.ok(borrador.camposFaltantes.some((c) => c.includes('Precio unitario de "Silla"')));
});

test('tasa fuera del enum cae al default 10%', () => {
  const borrador = construirBorrador(
    { cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 1, precioUnitario: 1000, tasa: 'invalida' }] },
    null,
  );
  assert.equal(borrador.items[0].tasa, '10%');
});

test('un cdc nuevo y distinto al anterior resetea totalFactura/totalIvaFactura (fuerza reconsulta)', () => {
  const conTotal = { ...borradorVacio(), cdc: CDC, totalFactura: 550000, totalIvaFactura: 50000 };
  const actualizado = construirBorrador({ cdcExtraido: OTRO_CDC, cdcInvalidoExtraido: false, itemsIA: [] }, conTotal);

  assert.equal(actualizado.cdc, OTRO_CDC);
  assert.equal(actualizado.totalFactura, null);
  assert.equal(actualizado.totalIvaFactura, null);
});

test('mismo cdc mencionado de nuevo: no resetea el total ya consultado', () => {
  const conTotal = { ...borradorVacio(), cdc: CDC, totalFactura: 550000, totalIvaFactura: 50000 };
  const actualizado = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [] }, conTotal);

  assert.equal(actualizado.totalFactura, 550000);
  assert.equal(actualizado.totalIvaFactura, 50000);
});

test('sin cdc nuevo en el mensaje: conserva el cdc y el total del borrador anterior', () => {
  const conTotal = { ...borradorVacio(), cdc: CDC, totalFactura: 550000, totalIvaFactura: 50000 };
  const actualizado = construirBorrador({ cdcExtraido: null, cdcInvalidoExtraido: false, itemsIA: [] }, conTotal);

  assert.equal(actualizado.cdc, CDC);
  assert.equal(actualizado.totalFactura, 550000);
});

test('sanitizarBorradorParaIA expone solo items, nunca cdc/totales/camposFaltantes', () => {
  const borrador = construirBorrador(
    { cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 1, precioUnitario: 1000, tasa: '10%' }] },
    null,
  );
  const sanitizado = sanitizarBorradorParaIA(borrador);

  assert.deepEqual(Object.keys(sanitizado), ['items']);
  assert.equal(sanitizado.items[0].descripcion, 'Silla');
});

test('sonEquivalentes: mismos items (ignorando subtotal) son equivalentes', () => {
  const a = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 2, precioUnitario: 50000, tasa: '10%' }] }, null);
  const b = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'Silla', cantidad: 2, precioUnitario: 50000, tasa: '10%' }] }, a);

  assert.ok(sonEquivalentes(a, b));
});

test('sonEquivalentes: items distintos no son equivalentes', () => {
  const a = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 2, precioUnitario: 50000, tasa: '10%' }] }, null);
  const b = construirBorrador({ cdcExtraido: CDC, cdcInvalidoExtraido: false, itemsIA: [{ descripcion: 'silla', cantidad: 3, precioUnitario: 50000, tasa: '10%' }] }, a);

  assert.ok(!sonEquivalentes(a, b));
});
