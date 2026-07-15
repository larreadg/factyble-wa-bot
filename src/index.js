const express = require('express');
const env = require('./utils/env');
const logger = require('./utils/logger');
const routes = require('./routes');

const app = express();

app.use(express.json());
app.use(routes);

app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`);
});
