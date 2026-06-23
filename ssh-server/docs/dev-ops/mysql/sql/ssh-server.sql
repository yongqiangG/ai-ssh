SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 幂等建库：保证本脚本在 docker-entrypoint-initdb.d 中无论执行顺序如何都能独立成功
CREATE DATABASE IF NOT EXISTS `ai_ssh` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ai_ssh`;

-- ----------------------------
-- Table structure for ssh_connection（基础配置）
-- ----------------------------
DROP TABLE IF EXISTS `ssh_connection`;
CREATE TABLE `ssh_connection` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `connection_id` varchar(64) NOT NULL DEFAULT '' COMMENT '连接唯一标识(UUID)',
  `host` varchar(128) NOT NULL DEFAULT '' COMMENT '主机地址',
  `port` int NOT NULL DEFAULT 22 COMMENT '端口',
  `username` varchar(64) NOT NULL DEFAULT '' COMMENT '用户名',
  `auth_type` varchar(16) NOT NULL DEFAULT 'PASSWORD' COMMENT '认证类型 PASSWORD/PUBLIC_KEY',
  `password` varchar(255) DEFAULT NULL COMMENT '密码',
  `private_key` text COMMENT 'SSH私钥(PEM)',
  `status` tinyint NOT NULL DEFAULT 0 COMMENT '连接状态 0未连接 1已连接',
  `user_id` varchar(64) NOT NULL DEFAULT '' COMMENT '用户ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` tinyint NOT NULL DEFAULT 0 COMMENT '逻辑删除 0未删 1已删',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_connection_id` (`connection_id`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SSH连接基础配置';

-- ----------------------------
-- Table structure for ssh_connection_config（高级配置）
-- ----------------------------
DROP TABLE IF EXISTS `ssh_connection_config`;
CREATE TABLE `ssh_connection_config` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
  `connection_id` varchar(64) NOT NULL DEFAULT '' COMMENT '连接唯一标识',
  `connect_timeout` int NOT NULL DEFAULT 5000 COMMENT '连接超时(毫秒)',
  `keepalive_interval` int NOT NULL DEFAULT 30000 COMMENT 'keepalive间隔(毫秒)',
  `startup_command` varchar(512) DEFAULT NULL COMMENT '连接后执行的启动命令',
  `strict_host_key_check` tinyint NOT NULL DEFAULT 0 COMMENT '严格主机密钥检查 0关 1开',
  `known_hosts` text COMMENT '已知主机密钥列表',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_connection_id` (`connection_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='SSH连接高级配置';
