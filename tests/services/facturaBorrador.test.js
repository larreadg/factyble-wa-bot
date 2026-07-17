const test = require('node:test');
const assert = require('node:assert/strict');
const { construirBorrador, borradorVacio, sanitizarBorradorParaIA, sonEquivalentes, migrarBorradorLegado } = require('../../src/services/facturaBorrador.service');

test('caso 1: solicitud completa calcula subtotales y total general en el backend', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [
      { descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' },
      { descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: 35000, tasa: '10%' },
    ],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.camposFaltantes.length, 0);
  assert.equal(borrador.items[0].subtotal, 5000);
  assert.equal(borrador.items[1].subtotal, 70000);
  assert.equal(borrador.totales.subtotal, 75000);
  assert.equal(borrador.totales.totalGeneral, 75000);
  assert.equal(borrador.version, 1);
});

test('caso 2: sin documento queda con camposFaltantes pidiendo RUC o cédula', () => {
  const facturaIA = {
    cliente: { nombre: 'María Benítez', tipoDocumento: null, numeroDocumento: null },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Cuaderno', cantidad: 3, precioUnitario: 12000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.ok(borrador.camposFaltantes.some((c) => c.includes('RUC') && c.includes('cédula')));
});

test('número de documento ambiguo (tipoDocumento=null) se conserva en el borrador en vez de descartarse', () => {
  const facturaIA = {
    cliente: { nombre: 'Juan Ruiz', tipoDocumento: null, numeroDocumento: '4567890' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Teclado', cantidad: 1, precioUnitario: 350000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.cliente.tipoDocumento, null);
  assert.equal(borrador.cliente.numeroDocumento, '4567890');
  assert.ok(borrador.camposFaltantes.some((c) => c.includes('RUC') && c.includes('cédula')));
});

test('aclaración de tipo sobre un número pendiente: el usuario solo dice "es cédula" sin repetir el número', () => {
  const borradorAnterior = construirBorrador(
    {
      cliente: { nombre: 'Juan Ruiz', tipoDocumento: null, numeroDocumento: '4567890' },
      condicionVenta: 'CONTADO',
      items: [{ descripcion: 'Teclado', cantidad: 1, precioUnitario: 350000, tasa: '10%' }],
    },
    null,
    [],
  );

  const facturaAclarada = {
    cliente: { nombre: 'Juan Ruiz', tipoDocumento: 'CI', numeroDocumento: '4567890' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Teclado', cantidad: 1, precioUnitario: 350000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaAclarada, borradorAnterior, []);

  assert.equal(borrador.cliente.tipoDocumento, 'CI');
  assert.equal(borrador.cliente.numeroDocumento, '4567890');
  assert.equal(borrador.camposFaltantes.length, 0);
});

test('caso 3: sin precio unitario pide el precio del producto correspondiente', () => {
  const facturaIA = {
    cliente: { nombre: 'María Benítez', tipoDocumento: 'RUC', numeroDocumento: '80000000-1' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: null, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.ok(borrador.camposFaltantes.some((c) => c.includes('Precio unitario') && c.includes('Peluche de oso')));
});

test('caso 4: corrección actualiza el borrador, sube version y recalcula totales', () => {
  const borradorAnterior = construirBorrador(
    {
      cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
      condicionVenta: 'CONTADO',
      items: [{ descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: 35000, tasa: '10%' }],
    },
    null,
    [],
  );

  const facturaCorregida = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: 30000, tasa: '10%' }],
  };

  const borradorCorregido = construirBorrador(facturaCorregida, borradorAnterior, []);

  assert.equal(borradorCorregido.version, borradorAnterior.version + 1);
  assert.equal(borradorCorregido.items[0].precioUnitario, 30000);
  assert.equal(borradorCorregido.totales.totalGeneral, 60000);
});

test('RUC con formato inválido no se acepta y queda en camposFaltantes', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: 'no-es-un-ruc' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.cliente.numeroDocumento, null);
  assert.ok(borrador.camposFaltantes.some((c) => c.includes('formato indicado no es válido')));
});

test('el backend ignora cualquier total propuesto por la IA y siempre recalcula', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Borrador', cantidad: 3, precioUnitario: 1000, tasa: '10%' }],
    // Un total inventado no debería existir en el esquema de la IA; aunque llegara, no se usa.
    totales: { subtotal: 999999, totalGeneral: 999999 },
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.totales.totalGeneral, 3000);
});

test('borradorVacio no tiene campos faltantes calculados pero representa ausencia de datos', () => {
  const vacio = borradorVacio();
  assert.equal(vacio.cliente.nombre, null);
  assert.equal(vacio.cliente.tipoDocumento, null);
  assert.equal(vacio.cliente.numeroDocumento, null);
  assert.equal(vacio.condicionVenta, 'CONTADO');
  assert.equal(vacio.items.length, 0);
  assert.equal(vacio.idempotencyKey, null);
  assert.equal(vacio.resultadoEmision, null);
});

test('tasa por defecto: item sin tasa (o con valor inválido) recibe 10% por defecto', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [
      { descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: undefined },
      { descripcion: 'Cuaderno', cantidad: 1, precioUnitario: 3000, tasa: '25%' },
    ],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.items[0].tasa, '10%');
  assert.equal(borrador.items[1].tasa, '10%');
});

test('tasa explícita distinta de la de por defecto se respeta', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Producto exento', cantidad: 1, precioUnitario: 5000, tasa: '0%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.items[0].tasa, '0%');
});

test('condicionVenta por defecto es CONTADO cuando falta o es inválida', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: undefined,
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.condicionVenta, 'CONTADO');
});

test('condicionVenta CREDITO explícita se respeta', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CREDITO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.condicionVenta, 'CREDITO');
});

test('sanitizarBorradorParaIA conserva tasa y condicionVenta para dar contexto en correcciones', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CREDITO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '5%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);
  const sanitizado = sanitizarBorradorParaIA(borrador);

  assert.equal(sanitizado.condicionVenta, 'CREDITO');
  assert.equal(sanitizado.items[0].tasa, '5%');
});

test('capitaliza la primera letra de la descripción sin tocar el resto', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'telefono Samsung Galaxy s24', cantidad: 1, precioUnitario: 3000000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.items[0].descripcion, 'Telefono Samsung Galaxy s24');
});

test('cliente con cédula (CI) queda con el documento completo: no pide RUC', () => {
  const facturaIA = {
    cliente: { nombre: 'Arnaldo Larrea', tipoDocumento: 'CI', numeroDocumento: '1597455' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Kg de pan', cantidad: 1, precioUnitario: 10000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, null, []);

  assert.equal(borrador.cliente.tipoDocumento, 'CI');
  assert.equal(borrador.cliente.numeroDocumento, '1597455');
  assert.equal(borrador.camposFaltantes.length, 0);
});

test('cliente distinto (documento diferente y no nulo) descarta ítems idénticos al borrador anterior y reinicia version/idempotencyKey/resultadoEmision', () => {
  const borradorArnaldo = construirBorrador(
    {
      cliente: { nombre: 'Arnaldo Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
      condicionVenta: 'CREDITO',
      items: [{ descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: 35000, tasa: '10%' }],
    },
    null,
    [],
  );
  // Simula que el borrador ya traía una emisión asociada (nunca debería cruzar a otro cliente).
  const borradorConEmisionPrevia = { ...borradorArnaldo, idempotencyKey: 'clave-vieja', resultadoEmision: { documentoId: 1 } };

  const facturaIA = {
    cliente: { nombre: 'Universidad San Lorenzo', tipoDocumento: 'RUC', numeroDocumento: '1707133-8' },
    condicionVenta: 'CONTADO',
    items: [
      // La IA arrastró indebidamente el ítem del cliente anterior (idéntico en todo):
      { descripcion: 'Peluche de oso', cantidad: 2, precioUnitario: 35000, tasa: '10%' },
      { descripcion: 'Honorarios por servicio de enseñanza docente', cantidad: 1, precioUnitario: 1200000, tasa: '0%' },
    ],
  };

  const borrador = construirBorrador(facturaIA, borradorConEmisionPrevia, []);

  assert.equal(borrador.items.length, 1);
  assert.equal(borrador.items[0].descripcion, 'Honorarios por servicio de enseñanza docente');
  assert.equal(borrador.cliente.numeroDocumento, '1707133-8');
  assert.equal(borrador.condicionVenta, 'CONTADO');
  assert.equal(borrador.version, 1);
  assert.equal(borrador.idempotencyKey, null);
  assert.equal(borrador.resultadoEmision, null);
});

test('cliente distinto con cédula previa también dispara el descarte forzado de ítems (la cédula es un documento válido)', () => {
  const borradorConCedula = construirBorrador(
    {
      cliente: { nombre: 'Arnaldo Larrea', tipoDocumento: 'CI', numeroDocumento: '1597455' },
      condicionVenta: 'CREDITO',
      items: [{ descripcion: 'Kg de pan', cantidad: 1, precioUnitario: 10000, tasa: '10%' }],
    },
    null,
    [],
  );

  const facturaIA = {
    cliente: { nombre: 'Universidad San Lorenzo', tipoDocumento: 'RUC', numeroDocumento: '1707133-8' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Honorarios por servicio de enseñanza docente', cantidad: 1, precioUnitario: 1200000, tasa: '0%' }],
  };

  const borrador = construirBorrador(facturaIA, borradorConCedula, []);

  assert.equal(borrador.items.length, 1);
  assert.equal(borrador.items[0].descripcion, 'Honorarios por servicio de enseñanza docente');
  assert.equal(borrador.idempotencyKey, null);
});

test('sonEquivalentes ignora version/camposFaltantes/totales pero detecta cambios reales', () => {
  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%' }],
  };

  const a = construirBorrador(facturaIA, null, []);
  const b = construirBorrador(facturaIA, a, []);

  assert.notEqual(a.version, b.version);
  assert.equal(sonEquivalentes(a, b), true);

  const facturaConOtroPrecio = { ...facturaIA, items: [{ ...facturaIA.items[0], precioUnitario: 6000 }] };
  const c = construirBorrador(facturaConOtroPrecio, a, []);

  assert.equal(sonEquivalentes(a, c), false);
});

test('migrarBorradorLegado convierte cliente.ruc al esquema nuevo', () => {
  const legado = { cliente: { nombre: 'Diego Larrea', ruc: '5249657-0', esCedula: false }, items: [] };

  const migrado = migrarBorradorLegado(legado);

  assert.deepEqual(migrado.cliente, { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' });
});

test('migrarBorradorLegado con esCedula=true sin número deja el documento incompleto (el esquema viejo no guardaba el número de cédula)', () => {
  const legado = { cliente: { nombre: 'Arnaldo Larrea', ruc: null, esCedula: true }, items: [] };

  const migrado = migrarBorradorLegado(legado);

  assert.deepEqual(migrado.cliente, { nombre: 'Arnaldo Larrea', tipoDocumento: null, numeroDocumento: null });
});

test('migrarBorradorLegado no toca un borrador que ya está en el esquema nuevo', () => {
  const nuevo = construirBorrador(
    { cliente: { nombre: 'Diego Larrea', tipoDocumento: 'CI', numeroDocumento: '1597455' }, condicionVenta: 'CONTADO', items: [] },
    null,
    [],
  );

  const migrado = migrarBorradorLegado(nuevo);

  assert.deepEqual(migrado.cliente, nuevo.cliente);
});

test('construirBorrador migra un borrador anterior legado antes de comparar cambio de cliente', () => {
  const anteriorLegado = { version: 3, cliente: { nombre: 'Diego Larrea', ruc: '5249657-0', esCedula: false }, items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 5000, tasa: '10%', subtotal: 5000 }], idempotencyKey: 'clave-vieja', resultadoEmision: null };

  const facturaIA = {
    cliente: { nombre: 'Diego Larrea', tipoDocumento: 'RUC', numeroDocumento: '5249657-0' },
    condicionVenta: 'CONTADO',
    items: [{ descripcion: 'Borrador', cantidad: 1, precioUnitario: 6000, tasa: '10%' }],
  };

  const borrador = construirBorrador(facturaIA, anteriorLegado, []);

  // Mismo cliente (mismo numeroDocumento tras migrar): no se descarta el borrador anterior.
  assert.equal(borrador.version, 4);
  assert.equal(borrador.idempotencyKey, 'clave-vieja');
});
