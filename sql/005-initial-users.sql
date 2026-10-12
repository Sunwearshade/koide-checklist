-- Cuentas iniciales de administrador de mantenimiento: sergio y omar. Solo se guardan hashes scrypt.
-- Idempotente: INSERT IGNORE no modifica una cuenta que ya exista ni restablece su contraseña.
-- Reversión manual: DELETE FROM user_sessions WHERE username IN ('sergio','omar'); DELETE FROM users WHERE username IN ('sergio','omar');
INSERT IGNORE INTO users(username,display_name,role,password_hash) VALUES('sergio','Sergio','admin','scrypt:49b5b966e6dc70f3b2faac79050a3f75:eeede3347480d721bf41494a0c7bc3f30c8e0ee395251251f0cfa7112fde497424312833299b22675c454dd5c0184f50befa7b7acaa92d390fe0d7c3d68c73a6');
INSERT IGNORE INTO users(username,display_name,role,password_hash) VALUES('omar','Omar','admin','scrypt:0cb8b6234141e780d169e2a47aba3b19:d895100b3bdb0f94b97a638a9195a70a95c58181141e758d2f0b4437d1154dc97c5f94c315456037356283d319117478ade471528c05eb4810912e4187162409');
