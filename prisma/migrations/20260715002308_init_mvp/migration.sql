-- CreateTable
CREATE TABLE `Empresa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruc` VARCHAR(191) NOT NULL,
    `razonSocial` VARCHAR(191) NOT NULL,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Empresa_ruc_key`(`ruc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contacto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresaId` INTEGER NOT NULL,
    `numeroTelefono` VARCHAR(191) NOT NULL,
    `whatsappId` VARCHAR(191) NULL,
    `nombre` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contacto_numeroTelefono_key`(`numeroTelefono`),
    UNIQUE INDEX `Contacto_whatsappId_key`(`whatsappId`),
    INDEX `Contacto_empresaId_idx`(`empresaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Conversacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contactoId` INTEGER NOT NULL,
    `estado` ENUM('ABIERTA', 'CERRADA') NOT NULL DEFAULT 'ABIERTA',
    `fechaInicio` DATETIME(3) NOT NULL,
    `fechaUltimoMensaje` DATETIME(3) NULL,
    `fechaCierre` DATETIME(3) NULL,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    INDEX `Conversacion_contactoId_idx`(`contactoId`),
    INDEX `Conversacion_estado_idx`(`estado`),
    INDEX `Conversacion_fechaUltimoMensaje_idx`(`fechaUltimoMensaje`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Partial unique index emulation: MySQL has no `WHERE` clause on indexes, so a
-- stored generated column (NULL unless estado = 'ABIERTA') plus a plain UNIQUE
-- index enforces "at most one ABIERTA conversation per contacto" (MySQL treats
-- multiple NULLs in a unique index as distinct).
ALTER TABLE `Conversacion` ADD COLUMN `contactoIdAbierta` INTEGER
    GENERATED ALWAYS AS (CASE WHEN `estado` = 'ABIERTA' THEN `contactoId` ELSE NULL END) STORED;

CREATE UNIQUE INDEX `Conversacion_contactoId_abierta_key` ON `Conversacion`(`contactoIdAbierta`);

-- CreateTable
CREATE TABLE `Mensaje` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversacionId` INTEGER NOT NULL,
    `whatsappMensajeId` VARCHAR(191) NULL,
    `direccion` ENUM('ENTRANTE', 'SALIENTE') NOT NULL,
    `tipo` ENUM('TEXTO', 'AUDIO', 'IMAGEN', 'DOCUMENTO') NOT NULL,
    `contenidoTexto` TEXT NULL,
    `estado` ENUM('RECIBIDO', 'PENDIENTE', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO') NOT NULL,
    `fechaMensaje` DATETIME(3) NOT NULL,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Mensaje_whatsappMensajeId_key`(`whatsappMensajeId`),
    INDEX `Mensaje_conversacionId_idx`(`conversacionId`),
    INDEX `Mensaje_estado_idx`(`estado`),
    INDEX `Mensaje_fechaMensaje_idx`(`fechaMensaje`),
    INDEX `Mensaje_conversacionId_fechaMensaje_idx`(`conversacionId`, `fechaMensaje`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MensajeArchivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mensajeId` INTEGER NOT NULL,
    `whatsappMediaId` VARCHAR(191) NULL,
    `nombreArchivo` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `tamanioBytes` INTEGER NULL,
    `rutaArchivo` VARCHAR(191) NULL,
    `transcripcion` TEXT NULL,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MensajeArchivo_mensajeId_key`(`mensajeId`),
    INDEX `MensajeArchivo_whatsappMediaId_idx`(`whatsappMediaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SesionConversacional` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversacionId` INTEGER NOT NULL,
    `intencionActual` VARCHAR(191) NULL,
    `estado` VARCHAR(191) NOT NULL,
    `datosTemporales` JSON NOT NULL,
    `ultimoMensajeId` INTEGER NULL,
    `fechaExpiracion` DATETIME(3) NULL,
    `fechaCreacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fechaModificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SesionConversacional_conversacionId_key`(`conversacionId`),
    INDEX `SesionConversacional_estado_idx`(`estado`),
    INDEX `SesionConversacional_fechaExpiracion_idx`(`fechaExpiracion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Contacto` ADD CONSTRAINT `Contacto_empresaId_fkey` FOREIGN KEY (`empresaId`) REFERENCES `Empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Conversacion` ADD CONSTRAINT `Conversacion_contactoId_fkey` FOREIGN KEY (`contactoId`) REFERENCES `Contacto`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `Mensaje` ADD CONSTRAINT `Mensaje_conversacionId_fkey` FOREIGN KEY (`conversacionId`) REFERENCES `Conversacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MensajeArchivo` ADD CONSTRAINT `MensajeArchivo_mensajeId_fkey` FOREIGN KEY (`mensajeId`) REFERENCES `Mensaje`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SesionConversacional` ADD CONSTRAINT `SesionConversacional_conversacionId_fkey` FOREIGN KEY (`conversacionId`) REFERENCES `Conversacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SesionConversacional` ADD CONSTRAINT `SesionConversacional_ultimoMensajeId_fkey` FOREIGN KEY (`ultimoMensajeId`) REFERENCES `Mensaje`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
