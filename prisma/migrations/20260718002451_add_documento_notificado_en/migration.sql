-- AlterTable
ALTER TABLE `documento` ADD COLUMN `notificado_en` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `documento_estado_sifen_notificado_en_idx` ON `documento`(`estado_sifen`, `notificado_en`);
