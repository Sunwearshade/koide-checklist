import mysql from 'mysql2/promise';
import fs from 'node:fs';
export function createPool(env=process.env){
 for(const key of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD'])if(!env[key]||env[key]==='CAMBIAR')throw Error('Configura '+key+' en .env.');
 const remote=!['127.0.0.1','localhost','::1'].includes(env.MYSQL_HOST);
 if(remote&&!env.MYSQL_SSL_CA)throw Error('MySQL remoto requiere MYSQL_SSL_CA.');
 return mysql.createPool({host:env.MYSQL_HOST,port:Number(env.MYSQL_PORT||3306),database:env.MYSQL_DATABASE,user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,charset:'utf8mb4',timezone:'Z',connectionLimit:10,waitForConnections:true,queueLimit:100,connectTimeout:10000,multipleStatements:false,supportBigNumbers:true,bigNumberStrings:true,...(env.MYSQL_SSL_CA?{ssl:{ca:fs.readFileSync(env.MYSQL_SSL_CA),rejectUnauthorized:true}}:{})});
}
