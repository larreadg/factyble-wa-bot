// El CDC (Código de Control) de SIFEN tiene exactamente 44 dígitos. Se extrae del
// texto crudo con regex, nunca vía IA: un LLM no reproduce con fiabilidad una cadena de
// 44 dígitos tal cual la escribió el usuario, y un CDC "casi correcto" haría fallar la
// llamada a la API de forma confusa para el usuario.
const CDC_LARGO = 44;

// Umbral para distinguir un "candidato a CDC mal pegado" (largo pero no 44) de
// cualquier otro número suelto en el mensaje (cantidades, precios, etc.), que
// normalmente no llegan a esta longitud.
const CANDIDATO_INVALIDO_LARGO_MINIMO = 20;

// Busca en el texto crudo grupos de dígitos, tolerando espacios/guiones/puntos
// intercalados dentro de un mismo grupo (ej. "0180 0695 9210...", copiado del KuDE con
// separadores visuales), pero sin unir números que están en frases distintas.
const GRUPO_DIGITOS_REGEX = /\d(?:[\d\s.-]*\d)?/g;

const extraerCdc = (texto) => {
  if (!texto || typeof texto !== 'string') return { cdc: null, candidatoInvalido: null };

  const grupos = texto.match(GRUPO_DIGITOS_REGEX) || [];
  const limpios = grupos.map((grupo) => grupo.replace(/\D+/g, ''));

  const cdc = limpios.find((limpio) => limpio.length === CDC_LARGO) || null;
  if (cdc) return { cdc, candidatoInvalido: null };

  const candidatoInvalido = limpios.find((limpio) => limpio.length >= CANDIDATO_INVALIDO_LARGO_MINIMO) || null;
  return { cdc: null, candidatoInvalido };
};

module.exports = { extraerCdc, CDC_LARGO };
