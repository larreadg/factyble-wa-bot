-- CreateTable
CREATE TABLE `empresa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ruc` VARCHAR(191) NOT NULL,
    `razon_social` VARCHAR(191) NOT NULL,
    `usuario` VARCHAR(191) NOT NULL,
    `password` TEXT NOT NULL,
    `token` TEXT NULL,
    `token_expiracion` DATETIME(3) NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `empresa_ruc_key`(`ruc`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `contacto` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresa_id` INTEGER NOT NULL,
    `numero_telefono` VARCHAR(191) NOT NULL,
    `whatsapp_id` VARCHAR(191) NULL,
    `nombre` VARCHAR(191) NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contacto_numero_telefono_key`(`numero_telefono`),
    UNIQUE INDEX `contacto_whatsapp_id_key`(`whatsapp_id`),
    INDEX `contacto_empresa_id_idx`(`empresa_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversacion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contacto_id` INTEGER NOT NULL,
    `estado` ENUM('ABIERTA', 'CERRADA') NOT NULL DEFAULT 'ABIERTA',
    `fecha_inicio` DATETIME(3) NOT NULL,
    `fecha_ultimo_mensaje` DATETIME(3) NULL,
    `fecha_cierre` DATETIME(3) NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    INDEX `conversacion_contacto_id_idx`(`contacto_id`),
    INDEX `conversacion_estado_idx`(`estado`),
    INDEX `conversacion_fecha_ultimo_mensaje_idx`(`fecha_ultimo_mensaje`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mensaje` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversacion_id` INTEGER NOT NULL,
    `whatsapp_mensaje_id` VARCHAR(191) NULL,
    `direccion` ENUM('ENTRANTE', 'SALIENTE') NOT NULL,
    `tipo` ENUM('TEXTO', 'AUDIO', 'IMAGEN', 'DOCUMENTO') NOT NULL,
    `contenido_texto` TEXT NULL,
    `estado` ENUM('RECIBIDO', 'PENDIENTE', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO') NOT NULL,
    `fecha_mensaje` DATETIME(3) NOT NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mensaje_whatsapp_mensaje_id_key`(`whatsapp_mensaje_id`),
    INDEX `mensaje_conversacion_id_idx`(`conversacion_id`),
    INDEX `mensaje_estado_idx`(`estado`),
    INDEX `mensaje_fecha_mensaje_idx`(`fecha_mensaje`),
    INDEX `mensaje_conversacion_id_fecha_mensaje_idx`(`conversacion_id`, `fecha_mensaje`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `mensaje_archivo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `mensaje_id` INTEGER NOT NULL,
    `whatsapp_media_id` VARCHAR(191) NULL,
    `nombre_archivo` VARCHAR(191) NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `tamanio_bytes` INTEGER NULL,
    `ruta_archivo` VARCHAR(191) NULL,
    `transcripcion` TEXT NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `mensaje_archivo_mensaje_id_key`(`mensaje_id`),
    INDEX `mensaje_archivo_whatsapp_media_id_idx`(`whatsapp_media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sesion_conversacional` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `conversacion_id` INTEGER NOT NULL,
    `intencion_actual` VARCHAR(191) NULL,
    `operacion_activa` VARCHAR(191) NULL,
    `estado` VARCHAR(191) NOT NULL,
    `datos_temporales` JSON NOT NULL,
    `ultimo_mensaje_id` INTEGER NULL,
    `fecha_expiracion` DATETIME(3) NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `sesion_conversacional_conversacion_id_key`(`conversacion_id`),
    INDEX `sesion_conversacional_estado_idx`(`estado`),
    INDEX `sesion_conversacional_fecha_expiracion_idx`(`fecha_expiracion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `contacto` ADD CONSTRAINT `contacto_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `conversacion` ADD CONSTRAINT `conversacion_contacto_id_fkey` FOREIGN KEY (`contacto_id`) REFERENCES `contacto`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `mensaje` ADD CONSTRAINT `mensaje_conversacion_id_fkey` FOREIGN KEY (`conversacion_id`) REFERENCES `conversacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mensaje_archivo` ADD CONSTRAINT `mensaje_archivo_mensaje_id_fkey` FOREIGN KEY (`mensaje_id`) REFERENCES `mensaje`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sesion_conversacional` ADD CONSTRAINT `sesion_conversacional_conversacion_id_fkey` FOREIGN KEY (`conversacion_id`) REFERENCES `conversacion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sesion_conversacional` ADD CONSTRAINT `sesion_conversacional_ultimo_mensaje_id_fkey` FOREIGN KEY (`ultimo_mensaje_id`) REFERENCES `mensaje`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
