// Evaluación manual del parser contra la API real de OpenAI. NO se ejecuta con
// `npm test` (usa mocks); correr explícitamente con `npm run eval:parser`.
// Requiere OPENAI_API_KEY configurada en el entorno/.env.
const facturaParserService = require('../src/services/facturaParser.service');
const fixtures = require('../tests/fixtures/facturaParserFixtures');
const logger = require('../src/utils/logger');

// Match parcial: todo campo presente en `esperado` debe coincidir en `actual`, pero
// `actual` puede tener campos de más sin que eso cuente como mismatch. Los arrays se
// comparan por longitud + posición, con el mismo match parcial en cada elemento.
const coincideParcial = (actual, esperado) => {
  if (esperado === null || typeof esperado !== 'object') return actual === esperado;

  if (Array.isArray(esperado)) {
    if (!Array.isArray(actual) || actual.length !== esperado.length) return false;
    return esperado.every((item, indice) => coincideParcial(actual[indice], item));
  }

  if (actual === null || typeof actual !== 'object') return false;
  return Object.keys(esperado).every((clave) => coincideParcial(actual[clave], esperado[clave]));
};

const run = async () => {
  let ok = 0;
  let total = 0;

  for (const fixture of fixtures) {
    total += 1;
    logger.info(`--- ${fixture.nombre} ---`);

    try {
      const resultado = await facturaParserService.interpretar({
        mensajeUsuario: fixture.texto,
        borradorActual: fixture.borradorPrevio,
      });

      const accionOk = !fixture.accionEsperada || resultado.accion === fixture.accionEsperada;
      const camposFaltantesOk =
        fixture.camposFaltantesEsperados == null ||
        JSON.stringify(resultado.camposFaltantes.slice().sort()) === JSON.stringify(fixture.camposFaltantesEsperados.slice().sort());
      const facturaOk = fixture.resultadoEsperado == null || coincideParcial(resultado.factura, fixture.resultadoEsperado);

      const casoOk = accionOk && camposFaltantesOk && facturaOk;

      logger.info(`accion=${resultado.accion} (esperada=${fixture.accionEsperada ?? 'sin verificar'}) ${accionOk ? 'OK' : 'MISMATCH'}`);
      logger.info(`camposFaltantes=${JSON.stringify(resultado.camposFaltantes)} ${camposFaltantesOk ? 'OK' : `MISMATCH (esperado=${JSON.stringify(fixture.camposFaltantesEsperados)})`}`);
      logger.info(`factura=${JSON.stringify(resultado.factura)} ${facturaOk ? 'OK' : `MISMATCH (esperado=${JSON.stringify(fixture.resultadoEsperado)})`}`);
      logger.info('advertencias:', JSON.stringify(resultado.advertencias));

      if (casoOk) ok += 1;
    } catch (error) {
      logger.error(`Error evaluando "${fixture.nombre}"`, error.type || error.name, error.message);
    }
  }

  logger.info(`Resultado: ${ok}/${total} casos OK (acción + camposFaltantes + factura)`);

  if (ok < total) process.exitCode = 1;
};

run().catch((error) => {
  logger.error('Error ejecutando evaluación del parser', error);
  process.exit(1);
});
