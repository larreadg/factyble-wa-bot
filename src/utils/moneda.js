const formatearGuaranies = (valor) => {
  const monto = Math.round(Number(valor) || 0);
  return `Gs. ${monto.toLocaleString('es-PY', { maximumFractionDigits: 0 })}`;
};

module.exports = { formatearGuaranies };
