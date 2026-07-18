-- CreateTable
CREATE TABLE `documento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `empresa_id` INTEGER NOT NULL,
    `numero_telefono` VARCHAR(191) NOT NULL,
    `tipo` ENUM('FACTURA', 'NOTA_CREDITO') NOT NULL,
    `cdc` VARCHAR(44) NOT NULL,
    `pdf_nombre` VARCHAR(191) NULL,
    `numero_documento_formateado` VARCHAR(191) NULL,
    `estado_sifen` ENUM('GENERADO', 'FIRMANDO', 'FIRMADO', 'ENCOLADO', 'ENVIADO', 'APROBADO', 'RECHAZADO', 'ERROR', 'CANCELADO') NULL,
    `sifen_estado_mensaje` TEXT NULL,
    `fecha_creacion` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `fecha_modificacion` DATETIME(3) NOT NULL,

    UNIQUE INDEX `documento_cdc_key`(`cdc`),
    INDEX `documento_empresa_id_idx`(`empresa_id`),
    INDEX `documento_estado_sifen_idx`(`estado_sifen`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `documento` ADD CONSTRAINT `documento_empresa_id_fkey` FOREIGN KEY (`empresa_id`) REFERENCES `empresa`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
