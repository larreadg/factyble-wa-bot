const { toFile } = require('openai/uploads');
const openaiService = require('./openai.service');
const { OpenAIServiceError } = require('./openai.errors');
const env = require('../utils/env');

const REINTENTO_BACKOFF_MS = 300;

// Mapeo de mime type de WhatsApp -> extensión soportada por la API de transcripciones
// de OpenAI. WhatsApp manda notas de voz como "audio/ogg; codecs=opus" casi siempre,
// por eso 'ogg' es el fallback cuando el mime type no matchea nada de la tabla.
const EXTENSION_POR_MIME = {
  'audio/aac': 'aac',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/amr': 'amr',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/wav': 'wav',
  'audio/webm': 'webm',
};

const resolverExtension = (mimeType) => {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSION_POR_MIME[base] || 'ogg';
};

const isTransient = (err) => {
  const status = err?.status;
  if (err?.name === 'APIConnectionTimeoutError' || err?.name === 'APIConnectionError') return true;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;
  return false;
};

const mapError = (err) => {
  if (err instanceof OpenAIServiceError) return err;

  const status = err?.status;
  if (err?.name === 'APIConnectionTimeoutError') return new OpenAIServiceError('TIMEOUT', 'Timeout al llamar a OpenAI', err);
  if (status === 429) return new OpenAIServiceError('RATE_LIMIT', 'Rate limit de OpenAI', err);
  if (status === 401 || status === 403) return new OpenAIServiceError('AUTH', 'Error de autenticación con OpenAI', err);
  if (err?.name === 'APIConnectionError') return new OpenAIServiceError('CONNECTION', 'Error de conexión con OpenAI', err);

  return new OpenAIServiceError('UNKNOWN', 'Error inesperado al llamar a OpenAI', err);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Transcribe un audio (buffer descargado de WhatsApp) a texto plano con
// gpt-4o-mini-transcribe. El texto resultante se procesa después exactamente igual que
// un mensaje de texto entrante (ver botOrchestrator.service.js).
const transcribir = async (buffer, mimeType) => {
  if (!buffer || !buffer.length) {
    throw new OpenAIServiceError('INVALID_INPUT', 'Audio vacío');
  }

  const client = openaiService.getClient();
  const archivo = await toFile(buffer, `audio.${resolverExtension(mimeType)}`, {
    type: mimeType || 'application/octet-stream',
  });

  const ejecutar = () =>
    client.audio.transcriptions.create({ file: archivo, model: env.OPENAI_TRANSCRIPTION_MODEL }, { timeout: env.OPENAI_TIMEOUT_MS });

  let response;
  try {
    response = await ejecutar();
  } catch (err) {
    if (isTransient(err)) {
      await sleep(REINTENTO_BACKOFF_MS);
      try {
        response = await ejecutar();
      } catch (err2) {
        throw mapError(err2);
      }
    } else {
      throw mapError(err);
    }
  }

  if (typeof response?.text !== 'string') {
    throw new OpenAIServiceError('EMPTY_RESPONSE', 'OpenAI no devolvió una transcripción');
  }

  return response.text;
};

module.exports = { transcribir };
