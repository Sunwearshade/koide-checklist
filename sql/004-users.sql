-- Usuario y contraseña (esquema 3). Compatible con instalaciones existentes: no elimina ni modifica tablas o registros.
-- Reversión manual: DROP TABLE user_sessions; DROP TABLE users; DELETE FROM schema_version WHERE version=3;
CREATE TABLE IF NOT EXISTS users(username VARCHAR(64) CHARACTER SET ascii PRIMARY KEY, display_name VARCHAR(120) NOT NULL, role VARCHAR(20) CHARACTER SET ascii NOT NULL, password_hash VARCHAR(300) NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_sessions(token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY, username VARCHAR(64) CHARACTER SET ascii NOT NULL, csrf CHAR(64) NOT NULL, expires_at DATETIME NOT NULL, INDEX(username), INDEX(expires_at)) ENGINE=InnoDB;
INSERT IGNORE INTO schema_version(version) VALUES(3);
