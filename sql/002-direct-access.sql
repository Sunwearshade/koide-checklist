-- Compatible with existing installations; no deletion or changes to records.
CREATE TABLE IF NOT EXISTS access_sessions(token_hash CHAR(64) CHARACTER SET ascii PRIMARY KEY, csrf CHAR(64) NOT NULL, expires_at DATETIME NOT NULL, admin_until DATETIME NULL, INDEX(expires_at)) ENGINE=InnoDB;
