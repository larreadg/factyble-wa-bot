const { normalizarTexto } = require('../utils/texto');
const { normalizarRuc } = require('../utils/ruc');
const { TASAS_IVA } = require('./facturaParser.service');

const TASA_POR_DEFECTO = '10%';
const CONDICION_VENTA_POR_DEFECTO = 'CONTADO';

const borradorVacio = () => ({
  version: 0,
  cliente: { nombre: null, tipoDocumento: null, numeroDocumento: null },
  condicionVenta: CONDICION_VENTA_POR_DEFECTO,
  items: [],
  camposFaltantes: [],
  advertencias: [],
  totales: { subtotal: 0, totalGeneral: 0 },
  idempotencyKey: null,
  resultadoEmision: null,
});

// Migra un borrador persistido con el esquema viejo (cliente.ruc/cliente.esCedula, de
// antes de que el bot soportara cédula) al esquema nuevo (cliente.tipoDocumento/
// cliente.numeroDocumento). No hay migración de base de datos porque datosTemporales es
// una columna JSON: los borradores en curso al momento del deploy quedan con la forma
// vieja y hay que normalizarlos al leerlos.
const migrarClienteLegado = (cliente) => {
  if (!cliente || 'numeroDocumento' in cliente) return cliente;
  if (cliente.ruc) return { nombre: cliente.nombre, tipoDocumento: 'RUC', numeroDocumento: cliente.ruc };
  // esCedula=true sin RUC: el esquema viejo nunca guardaba el número de cédula, así que
  // el documento queda incompleto (se le vuelve a pedir al usuario).
  return { nombre: cliente.nombre, tipoDocumento: null, numeroDocumento: null };
};

const migrarBorradorLegado = (borrador) => {
  if (!borrador) return borrador;
  return { ...borrador, cliente: migrarClienteLegado(borrador.cliente) };
};

const capitalizarPrimeraLetra = (texto) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto);

const mismoItem = (a, b) =>
  a.descripcion === b.descripcion && a.cantidad === b.cantidad && a.precioUnitario === b.precioUnitario && a.tasa === b.tasa;

// Normaliza el documento del cliente (RUC o cédula) que devolvió la IA. Solo el RUC
// tiene un formato validable (NNN...-D). La cédula no tiene dígito verificador ni
// formato a validar, pero la IA a veces la transcribe con puntos de miles (ej.
// "1.707.143"): nos quedamos solo con la parte numérica, sin inventar un algoritmo
// de checksum (igual criterio que ya se usaba para RUC).
const normalizarDocumento = (tipoDocumentoIA, numeroDocumentoIA) => {
  const tipoDocumento = tipoDocumentoIA === 'RUC' || tipoDocumentoIA === 'CI' ? tipoDocumentoIA : null;
  const numeroCrudo = typeof numeroDocumentoIA === 'string' && numeroDocumentoIA.trim() ? numeroDocumentoIA.trim() : null;

  if (!numeroCrudo) {
    return { tipoDocumento: null, numeroDocumento: null, invalido: false };
  }

  // Número presente pero todavía sin tipo (SOLICITAR_ACLARACION "¿es RUC o cédula?"):
  // se conserva tal cual en el borrador para que, cuando el usuario solo aclare el
  // tipo en el próximo mensaje ("es cédula"), la IA lo recupere del "Borrador actual"
  // sin que el usuario tenga que repetir el número.
  if (!tipoDocumento) {
    return { tipoDocumento: null, numeroDocumento: numeroCrudo, invalido: false };
  }

  if (tipoDocumento === 'RUC') {
    const ruc = normalizarRuc(numeroCrudo);
    return { tipoDocumento: ruc.valor ? 'RUC' : null, numeroDocumento: ruc.valor, invalido: ruc.invalido };
  }

  const cedula = numeroCrudo.replace(/\D+/g, '');
  return { tipoDocumento: cedula ? 'CI' : null, numeroDocumento: cedula || null, invalido: !cedula };
};

// Reconstruye el borrador completo a partir de la salida (ya validada por Zod) del
// parser de OpenAI. El backend es la única fuente de verdad para camposFaltantes y
// totales: nunca se usan los totales ni las validaciones de completitud de la IA.
// tasa/condicionVenta ya vienen acotadas por el enum de Zod, pero igual se
// normalizan acá a su valor por defecto ante cualquier dato faltante o inesperado,
// siguiendo el mismo principio de no confiar ciegamente en la IA.
const construirBorrador = (facturaIA, borradorAnteriorCrudo, advertenciasIA = []) => {
  const borradorAnterior = migrarBorradorLegado(borradorAnteriorCrudo);
  const nombre = normalizarTexto(facturaIA?.cliente?.nombre);
  const documento = normalizarDocumento(facturaIA?.cliente?.tipoDocumento, facturaIA?.cliente?.numeroDocumento);
  const condicionVenta = facturaIA?.condicionVenta === 'CREDITO' ? 'CREDITO' : CONDICION_VENTA_POR_DEFECTO;

  // El prompt le indica a la IA que, ante un cliente distinto (documento no nulo y
  // diferente al del borrador anterior), reinicie la factura desde cero. No confiamos
  // ciegamente en que esa regla se cumpla siempre: si detectamos el cambio de
  // documento acá, tratamos el borrador anterior como inexistente (no arrastramos
  // version/idempotencyKey/resultadoEmision de un cliente a otro) y, además, filtramos
  // cualquier ítem idéntico a uno que ya estaba en el borrador anterior (un ítem
  // calcado de un cliente distinto, mencionado en el mismo mensaje que el cambio, es
  // casi seguro un arrastre indebido de la IA, no una coincidencia real).
  const clienteCambio = Boolean(
    documento.numeroDocumento && borradorAnterior?.cliente?.numeroDocumento && documento.numeroDocumento !== borradorAnterior.cliente.numeroDocumento,
  );
  const borradorBase = clienteCambio ? null : borradorAnterior;

  const version = (borradorBase?.version || 0) + 1;

  let items = (facturaIA?.items || []).map((item) => {
    const descripcion = capitalizarPrimeraLetra(normalizarTexto(item.descripcion) || item.descripcion);
    const cantidad = typeof item.cantidad === 'number' ? item.cantidad : null;
    const precioUnitario = typeof item.precioUnitario === 'number' ? item.precioUnitario : null;
    const tasa = TASAS_IVA.includes(item.tasa) ? item.tasa : TASA_POR_DEFECTO;
    const subtotal = cantidad != null && precioUnitario != null ? Math.round(cantidad * precioUnitario) : null;

    return { descripcion, cantidad, precioUnitario, tasa, subtotal };
  });

  if (clienteCambio) {
    items = items.filter((item) => !(borradorAnterior.items || []).some((previo) => mismoItem(item, previo)));
  }

  const camposFaltantes = [];

  if (!nombre) camposFaltantes.push('Nombre del cliente');

  if (!documento.tipoDocumento || !documento.numeroDocumento) {
    camposFaltantes.push(documento.invalido ? 'RUC o cédula del cliente (el formato indicado no es válido)' : 'RUC o cédula del cliente');
  }

  if (items.length === 0) {
    camposFaltantes.push('Al menos un producto o servicio');
  }

  for (const item of items) {
    const etiqueta = item.descripcion || 'producto sin descripción';
    if (item.cantidad == null) camposFaltantes.push(`Cantidad de "${etiqueta}"`);
    if (item.precioUnitario == null) camposFaltantes.push(`Precio unitario de "${etiqueta}"`);
  }

  const subtotal = items.reduce((acumulado, item) => acumulado + (item.subtotal ?? 0), 0);

  return {
    version,
    cliente: { nombre, tipoDocumento: documento.tipoDocumento, numeroDocumento: documento.numeroDocumento },
    condicionVenta,
    items,
    camposFaltantes,
    advertencias: Array.isArray(advertenciasIA) ? advertenciasIA.slice(0, 20) : [],
    totales: { subtotal, totalGeneral: subtotal },
    idempotencyKey: borradorBase?.idempotencyKey ?? null,
    resultadoEmision: borradorBase?.resultadoEmision ?? null,
  };
};

// Lo único que se envía a la IA: nunca camposFaltantes/totales/idempotencyKey/resultadoEmision.
const sanitizarBorradorParaIA = (borradorCrudo) => {
  const borrador = migrarBorradorLegado(borradorCrudo);
  if (!borrador) return null;
  return {
    cliente: borrador.cliente,
    condicionVenta: borrador.condicionVenta,
    items: borrador.items.map(({ descripcion, cantidad, precioUnitario, tasa }) => ({ descripcion, cantidad, precioUnitario, tasa })),
  };
};

// Compara solo los datos de negocio (cliente, condición de venta, ítems), ignorando
// version/camposFaltantes/advertencias/totales/idempotencyKey/resultadoEmision. Se usa
// para detectar cuando un mensaje del usuario no produjo ningún cambio real en el
// borrador (ej. una corrección que la IA no supo aplicar), para avisarle en vez de
// reenviar la misma confirmación en silencio.
const sonEquivalentes = (borradorA, borradorB) => {
  const proyectar = (b) => ({ cliente: b.cliente, condicionVenta: b.condicionVenta, items: b.items.map(({ subtotal, ...resto }) => resto) });
  return JSON.stringify(proyectar(borradorA)) === JSON.stringify(proyectar(borradorB));
};

module.exports = { borradorVacio, construirBorrador, sanitizarBorradorParaIA, sonEquivalentes, migrarBorradorLegado };
