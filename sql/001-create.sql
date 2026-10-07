-- MySQL 8.4 / InnoDB. Run in a NEW database selected by IT, with utf8mb4.
-- Deliberately no DROP and no backup schedule. DDL is not transactional in MySQL.
CREATE TABLE schema_version(version INT PRIMARY KEY, applied_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6));
CREATE TABLE save_lock(id INT PRIMARY KEY, ng_number BIGINT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB;
INSERT INTO save_lock(id) VALUES(1);
CREATE TABLE documents(
 bucket VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 entity_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 value JSON NULL, version BIGINT UNSIGNED NOT NULL,
 updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 updated_by VARCHAR(128) NOT NULL,
 receipt_machine VARCHAR(40) GENERATED ALWAYS AS (IF(bucket='records',JSON_UNQUOTE(JSON_EXTRACT(value,'$.machine')),NULL)) STORED,
 receipt_day VARCHAR(10) GENERATED ALWAYS AS (IF(bucket='records',JSON_UNQUOTE(JSON_EXTRACT(value,'$.day')),NULL)) STORED,
 receipt_turn VARCHAR(8) GENERATED ALWAYS AS (IF(bucket='records',JSON_UNQUOTE(JSON_EXTRACT(value,'$.turn')),NULL)) STORED,
 PRIMARY KEY(bucket,entity_key), UNIQUE KEY one_reception(receipt_machine,receipt_day,receipt_turn)
) ENGINE=InnoDB;
CREATE TABLE requests(request_id CHAR(36) CHARACTER SET ascii PRIMARY KEY, username VARCHAR(128) NOT NULL, payload_hash CHAR(64) NOT NULL, saved_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6)) ENGINE=InnoDB;
CREATE TABLE audit(id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, request_id CHAR(36) NOT NULL, bucket VARCHAR(60) NOT NULL, entity_key VARCHAR(160) NOT NULL, username VARCHAR(128) NOT NULL, before_value JSON NULL, after_value JSON NULL, at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6), INDEX(request_id)) ENGINE=InnoDB;
CREATE TABLE employees(employee_number VARCHAR(40) CHARACTER SET ascii PRIMARY KEY, full_name VARCHAR(250) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)) ENGINE=InnoDB;
CREATE TABLE login_attempts(attempt_key CHAR(64) PRIMARY KEY, attempts INT NOT NULL DEFAULT 0, window_start DATETIME NOT NULL) ENGINE=InnoDB;
CREATE VIEW recepciones AS SELECT entity_key AS id, receipt_machine AS maquina, receipt_day AS fecha, receipt_turn AS turno, value->>'$.employee' AS empleado, value->>'$.name' AS nombre, value->>'$.operation' AS situacion, value, version, updated_at, updated_by FROM documents WHERE bucket='records' AND value IS NOT NULL;
CREATE VIEW incidencias AS SELECT entity_key AS id, value->>'$.machine' AS maquina, value->>'$.folio' AS folio, value->>'$.status' AS estado, value, version, updated_at FROM documents WHERE bucket='incidents' AND value IS NOT NULL;
CREATE VIEW evaluaciones AS SELECT bucket AS modulo, entity_key AS id, value->>'$.employee' AS empleado, value->>'$.name' AS nombre, value->>'$.day' AS fecha, CAST(value->>'$.score' AS DECIMAL(9,4)) AS calificacion, value, version, updated_at FROM documents WHERE bucket IN ('skillExams','skillMap.records') AND value IS NOT NULL;
INSERT INTO schema_version(version) VALUES(1);

-- Compatible with existing installations; no deletion or changes to records.
CREATE TABLE IF NOT EXISTS access_sessions(token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY, csrf CHAR(64) NOT NULL, expires_at DATETIME NOT NULL, admin_until DATETIME NULL, INDEX(expires_at)) ENGINE=InnoDB;
